import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.proof_workspace import ProofWorkspace
from models.user import User
from security import get_current_user
from services.proof_pipeline import build_formalization_bundle, extract_text_from_pdf

router = APIRouter(prefix="/proofs", tags=["proofs"])
settings = get_settings()


class AgentStepResponse(BaseModel):
    agent_id: str
    agent_name: str
    stage: str
    summary: str
    output_preview: str
    timestamp: str


class ProofWorkspaceSummaryResponse(BaseModel):
    id: int
    title: str
    source_kind: str
    source_filename: str | None
    status: str
    created_at: str
    updated_at: str


class ProofWorkspaceResponse(ProofWorkspaceSummaryResponse):
    source_text: str
    extracted_text: str
    lean4_code: str
    rocq_code: str
    agent_trace: list[AgentStepResponse]


class ProofWorkspaceCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    source_text: str = Field(min_length=1)


class ProofWorkspaceUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    source_text: str = Field(default="")
    extracted_text: str = Field(default="")
    lean4_code: str = Field(default="")
    rocq_code: str = Field(default="")


@router.get("/", response_model=list[ProofWorkspaceSummaryResponse])
def list_proof_workspaces(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProofWorkspaceSummaryResponse]:
    workspaces = (
        db.query(ProofWorkspace)
        .filter(ProofWorkspace.owner_id == current_user.id)
        .order_by(ProofWorkspace.updated_at.desc(), ProofWorkspace.id.desc())
        .all()
    )
    return [_to_summary_response(workspace) for workspace in workspaces]


@router.get("/{workspace_id}", response_model=ProofWorkspaceResponse)
def get_proof_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProofWorkspaceResponse:
    workspace = _get_workspace_or_404(db, current_user, workspace_id)
    return _to_detail_response(workspace)


@router.post(
    "/manual",
    response_model=ProofWorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_workspace(
    payload: ProofWorkspaceCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProofWorkspaceResponse:
    title = payload.title.strip()
    bundle = build_formalization_bundle(
        title=title,
        source_text=payload.source_text,
        source_kind="manual",
    )

    workspace = ProofWorkspace(
        owner_id=current_user.id,
        title=title,
        source_kind="manual",
        source_text=bundle["source_text"],
        extracted_text=bundle["extracted_text"],
        lean4_code=bundle["lean4_code"],
        rocq_code=bundle["rocq_code"],
        status=bundle["status"],
        agent_trace_json=bundle["agent_trace_json"],
    )
    db.add(workspace)
    db.commit()
    db.refresh(workspace)
    return _to_detail_response(workspace)


@router.post(
    "/upload-pdf",
    response_model=ProofWorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_pdf_workspace(
    title: str = Form(default=""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProofWorkspaceResponse:
    filename = file.filename or "uploaded-proof.pdf"
    if Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF uploads are supported.",
        )

    safe_name = f"{uuid4()}.pdf"
    upload_path = settings.proof_upload_dir / safe_name
    upload_path.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    upload_path.write_bytes(content)
    await file.close()

    try:
        extracted_text = extract_text_from_pdf(upload_path)
    except Exception as exc:  # pragma: no cover - defensive handling for parser failures
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse the uploaded PDF: {exc}",
        ) from exc
    if not extracted_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The uploaded PDF did not contain extractable text.",
        )

    normalized_title = title.strip() or Path(filename).stem or "Uploaded proof"
    bundle = build_formalization_bundle(
        title=normalized_title,
        source_text=extracted_text,
        source_kind="pdf",
        source_filename=filename,
    )

    workspace = ProofWorkspace(
        owner_id=current_user.id,
        title=normalized_title,
        source_kind="pdf",
        source_filename=filename,
        pdf_path=str(upload_path),
        source_text=bundle["source_text"],
        extracted_text=bundle["extracted_text"],
        lean4_code=bundle["lean4_code"],
        rocq_code=bundle["rocq_code"],
        status=bundle["status"],
        agent_trace_json=bundle["agent_trace_json"],
    )
    db.add(workspace)
    db.commit()
    db.refresh(workspace)
    return _to_detail_response(workspace)


@router.put("/{workspace_id}", response_model=ProofWorkspaceResponse)
def update_proof_workspace(
    workspace_id: int,
    payload: ProofWorkspaceUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProofWorkspaceResponse:
    workspace = _get_workspace_or_404(db, current_user, workspace_id)
    workspace.title = payload.title.strip()
    workspace.source_text = payload.source_text
    workspace.extracted_text = payload.extracted_text
    workspace.lean4_code = payload.lean4_code
    workspace.rocq_code = payload.rocq_code
    workspace.status = "edited"

    db.commit()
    db.refresh(workspace)
    return _to_detail_response(workspace)


@router.post("/{workspace_id}/regenerate", response_model=ProofWorkspaceResponse)
def regenerate_proof_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProofWorkspaceResponse:
    workspace = _get_workspace_or_404(db, current_user, workspace_id)
    source_text = workspace.source_text or workspace.extracted_text
    bundle = build_formalization_bundle(
        title=workspace.title,
        source_text=source_text,
        source_kind=workspace.source_kind,
        source_filename=workspace.source_filename,
    )

    workspace.source_text = source_text
    workspace.extracted_text = bundle["extracted_text"]
    workspace.lean4_code = bundle["lean4_code"]
    workspace.rocq_code = bundle["rocq_code"]
    workspace.status = bundle["status"]
    workspace.agent_trace_json = bundle["agent_trace_json"]

    db.commit()
    db.refresh(workspace)
    return _to_detail_response(workspace)


def _get_workspace_or_404(db: Session, current_user: User, workspace_id: int) -> ProofWorkspace:
    workspace = (
        db.query(ProofWorkspace)
        .filter(
            ProofWorkspace.id == workspace_id,
            ProofWorkspace.owner_id == current_user.id,
        )
        .first()
    )
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proof workspace not found.")
    return workspace


def _to_summary_response(workspace: ProofWorkspace) -> ProofWorkspaceSummaryResponse:
    return ProofWorkspaceSummaryResponse(
        id=workspace.id,
        title=workspace.title,
        source_kind=workspace.source_kind,
        source_filename=workspace.source_filename,
        status=workspace.status,
        created_at=workspace.created_at.isoformat(),
        updated_at=workspace.updated_at.isoformat(),
    )


def _to_detail_response(workspace: ProofWorkspace) -> ProofWorkspaceResponse:
    return ProofWorkspaceResponse(
        **_to_summary_response(workspace).model_dump(),
        source_text=workspace.source_text,
        extracted_text=workspace.extracted_text,
        lean4_code=workspace.lean4_code,
        rocq_code=workspace.rocq_code,
        agent_trace=json.loads(workspace.agent_trace_json or "[]"),
    )
