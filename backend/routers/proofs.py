import asyncio
import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.proof_workspace import ProofWorkspace
from models.user import User
from security import get_current_user
from services.lean_workspace import (
    LeanWorkspaceError,
    build_workspace_module,
    build_workspace_module_sync,
    write_workspace_file,
)
from services.project_workspace import validate_project_context_copy
from services.proof_pipeline import build_formalization_bundle, extract_text_from_pdf
from services.rag_index import sync_proof_workspace_to_rag
from services.verified_build_jobs import enqueue_verified_build_job

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
    has_pdf: bool
    status: str
    created_at: str
    updated_at: str
    build_job_id: str | None = None
    build_status: str | None = None
    build_error: str | None = None


class ProofWorkspaceResponse(ProofWorkspaceSummaryResponse):
    pdf_filename: str | None
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


async def _store_uploaded_pdf(file: UploadFile, *, destination: Path) -> int:
    total_bytes = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > settings.proof_upload_max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            "The uploaded PDF exceeds the "
                            f"{settings.proof_upload_max_bytes // (1024 * 1024)}MB limit."
                        ),
                    )
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    if total_bytes == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded PDF is empty.",
        )

    return total_bytes


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


@router.get("/{workspace_id}/pdf")
def get_proof_workspace_pdf(
    workspace_id: int,
    download: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    workspace = _get_workspace_or_404(db, current_user, workspace_id)
    if not workspace.pdf_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found for this workspace.",
        )

    pdf_path = Path(workspace.pdf_path)
    if not pdf_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The PDF file is missing.",
        )

    filename = workspace.source_filename or pdf_path.name
    content_disposition = "attachment" if download else "inline"
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'{content_disposition}; filename="{filename}"'},
    )


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
    saved_file = write_workspace_file(
        settings,
        code=workspace.lean4_code,
        title=workspace.title,
    )
    _build_saved_workspace_or_422(saved_file)
    asyncio.run(
        sync_proof_workspace_to_rag(
            db,
            settings=settings,
            workspace=workspace,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
        )
    )
    db.commit()
    db.refresh(workspace)
    return _to_detail_response(workspace)


@router.post(
    "/upload-pdf",
    response_model=ProofWorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_pdf_workspace(
    response: Response,
    title: str = Form(default=""),
    workspace_id: int | None = Form(default=None),
    lean4_code: str = Form(default=""),
    project_root: str | None = Form(default=None),
    project_file_path: str | None = Form(default=None),
    validation_project_root: str | None = Form(default=None),
    validation_project_file_path: str | None = Form(default=None),
    remix_provenance: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProofWorkspaceResponse:
    parsed_remix_provenance = _parse_form_json_object_or_422(
        remix_provenance,
        field_name="remix_provenance",
    )
    filename = file.filename or "uploaded-proof.pdf"
    if Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF uploads are supported.",
        )

    safe_name = f"{uuid4()}.pdf"
    upload_path = settings.proof_upload_dir / safe_name
    upload_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        await _store_uploaded_pdf(file, destination=upload_path)
    finally:
        await file.close()

    try:
        extracted_text = extract_text_from_pdf(upload_path)
    except Exception as exc:  # pragma: no cover - defensive handling for parser failures
        _safe_delete_uploaded_pdf(str(upload_path))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse the uploaded PDF: {exc}",
        ) from exc
    if not extracted_text:
        _safe_delete_uploaded_pdf(str(upload_path))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The uploaded PDF did not contain extractable text.",
        )

    normalized_title = title.strip() or Path(filename).stem or "Uploaded proof"
    preserved_lean_code = lean4_code.strip()
    bundle = build_formalization_bundle(
        title=normalized_title,
        source_text=extracted_text,
        source_kind="pdf",
        source_filename=filename,
    )

    previous_pdf_path: str | None = None
    final_workspace_status = "edited" if preserved_lean_code else bundle["status"]
    if workspace_id is not None:
        workspace = _get_workspace_or_404(db, current_user, workspace_id)
        previous_pdf_path = workspace.pdf_path
        workspace.title = normalized_title
        workspace.source_kind = "pdf"
        workspace.source_filename = filename
        workspace.pdf_path = str(upload_path)
        workspace.source_text = bundle["source_text"]
        workspace.extracted_text = bundle["extracted_text"]
        workspace.lean4_code = preserved_lean_code or bundle["lean4_code"]
        workspace.rocq_code = bundle["rocq_code"]
        workspace.status = "building"
        workspace.agent_trace_json = bundle["agent_trace_json"]
        response.status_code = status.HTTP_200_OK
    else:
        workspace = ProofWorkspace(
            owner_id=current_user.id,
            title=normalized_title,
            source_kind="pdf",
            source_filename=filename,
            pdf_path=str(upload_path),
            source_text=bundle["source_text"],
            extracted_text=bundle["extracted_text"],
            lean4_code=preserved_lean_code or bundle["lean4_code"],
            rocq_code=bundle["rocq_code"],
            status="building",
            agent_trace_json=bundle["agent_trace_json"],
        )
        db.add(workspace)

    db.commit()
    db.refresh(workspace)

    if previous_pdf_path and previous_pdf_path != str(upload_path):
        _safe_delete_uploaded_pdf(previous_pdf_path)

    saved_file = write_workspace_file(
        settings,
        code=workspace.lean4_code,
        title=workspace.title,
    )
    queued_job = enqueue_verified_build_job(
        settings=settings,
        owner_id=current_user.id,
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        title=workspace.title,
        code=workspace.lean4_code,
        proof_workspace_id=workspace.id,
        pdf_filename=workspace.source_filename if workspace.pdf_path else None,
        project_root=project_root,
        project_file_path=project_file_path,
        validation_project_root=validation_project_root,
        validation_project_file_path=validation_project_file_path,
        remix_provenance=parsed_remix_provenance,
        final_workspace_status=final_workspace_status,
    )
    detail = _to_detail_response(workspace)
    detail.build_job_id = str(queued_job["job_id"])
    detail.build_status = str(queued_job["status"])
    detail.build_error = queued_job["error"] if isinstance(queued_job["error"], str) else None
    return detail


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
    saved_file = write_workspace_file(
        settings,
        code=workspace.lean4_code,
        title=workspace.title,
    )
    _build_saved_workspace_or_422(saved_file)
    asyncio.run(
        sync_proof_workspace_to_rag(
            db,
            settings=settings,
            workspace=workspace,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
        )
    )
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
    saved_file = write_workspace_file(
        settings,
        code=workspace.lean4_code,
        title=workspace.title,
    )
    _build_saved_workspace_or_422(saved_file)
    asyncio.run(
        sync_proof_workspace_to_rag(
            db,
            settings=settings,
            workspace=workspace,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
        )
    )
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


def _safe_delete_uploaded_pdf(file_path: str | None) -> None:
    if not file_path:
        return

    try:
        candidate = Path(file_path).resolve()
        uploads_root = settings.proof_upload_dir.resolve()
    except OSError:
        return

    if uploads_root not in candidate.parents:
        return

    try:
        candidate.unlink(missing_ok=True)
    except OSError:
        return


def _parse_form_json_object_or_422(raw_value: str | None, *, field_name: str) -> dict[str, object] | None:
    if raw_value is None or not raw_value.strip():
        return None

    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} must be valid JSON.",
        ) from exc

    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} must be a JSON object.",
        )

    return parsed


def _build_saved_workspace_or_422(
    saved_file: dict[str, str],
    *,
    content: str | None = None,
    project_root: str | None = None,
    project_file_path: str | None = None,
) -> None:
    try:
        build_workspace_module_sync(
            settings,
            relative_workspace_path=saved_file["path"],
            module_name=saved_file["module"],
        )
    except LeanWorkspaceError as exc:
        if project_root and project_file_path and content is not None:
            try:
                asyncio.run(
                    validate_project_context_copy(
                        settings,
                        project_root=project_root,
                        source_relative_path=project_file_path,
                        content=content,
                    )
                )
            except LeanWorkspaceError as project_exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(project_exc),
                ) from project_exc
            return
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


async def _build_saved_workspace_async_or_422(
    saved_file: dict[str, str],
    *,
    content: str | None = None,
    project_root: str | None = None,
    project_file_path: str | None = None,
) -> None:
    try:
        await build_workspace_module(
            settings,
            relative_workspace_path=saved_file["path"],
            module_name=saved_file["module"],
        )
    except LeanWorkspaceError as exc:
        if project_root and project_file_path and content is not None:
            try:
                await validate_project_context_copy(
                    settings,
                    project_root=project_root,
                    source_relative_path=project_file_path,
                    content=content,
                )
            except LeanWorkspaceError as project_exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(project_exc),
                ) from project_exc
            return
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


def _to_summary_response(workspace: ProofWorkspace) -> ProofWorkspaceSummaryResponse:
    return ProofWorkspaceSummaryResponse(
        id=workspace.id,
        title=workspace.title,
        source_kind=workspace.source_kind,
        source_filename=workspace.source_filename,
        has_pdf=bool(workspace.pdf_path),
        status=workspace.status,
        created_at=workspace.created_at.isoformat(),
        updated_at=workspace.updated_at.isoformat(),
    )


def _to_detail_response(workspace: ProofWorkspace) -> ProofWorkspaceResponse:
    return ProofWorkspaceResponse(
        **_to_summary_response(workspace).model_dump(),
        pdf_filename=workspace.source_filename if workspace.pdf_path else None,
        source_text=workspace.source_text,
        extracted_text=workspace.extracted_text,
        lean4_code=workspace.lean4_code,
        rocq_code=workspace.rocq_code,
        agent_trace=json.loads(workspace.agent_trace_json or "[]"),
    )
