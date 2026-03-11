from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.code_document import CodeDocument
from models.proof_workspace import ProofWorkspace
from models.user import User
from security import get_current_user, get_current_user_optional
from services.lean_workspace import LeanWorkspaceError, build_workspace_module, delete_workspace_file, write_workspace_file
from services.rag_index import (
    cleanup_missing_workspace_documents,
    delete_indexed_document,
    sync_playground_document_to_rag,
    sync_proof_workspace_to_rag,
)

router = APIRouter(prefix="/theorems", tags=["theorems"])
settings = get_settings()


class TheoremSummaryResponse(BaseModel):
    id: int
    title: str
    statement: str
    proof_language: str
    is_verified: bool
    can_edit: bool
    source_kind: str
    status: str
    updated_at: str
    path: str | None
    module_name: str | None


class TheoremDetailResponse(TheoremSummaryResponse):
    content: str


class TheoremUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1)


def _build_workspace_lookup(
    db: Session,
    documents: list[CodeDocument],
) -> dict[int, ProofWorkspace]:
    workspace_ids = sorted(
        {
            document.source_ref_id
            for document in documents
            if document.source_kind == "proof_workspace" and document.source_ref_id is not None
        }
    )
    if not workspace_ids:
        return {}

    workspaces = (
        db.query(ProofWorkspace)
        .filter(ProofWorkspace.id.in_(workspace_ids))
        .all()
    )
    return {workspace.id: workspace for workspace in workspaces}


def _build_summary(
    document: CodeDocument,
    workspace_lookup: dict[int, ProofWorkspace],
    current_user: User | None = None,
) -> TheoremSummaryResponse:
    workspace = (
        workspace_lookup.get(document.source_ref_id)
        if document.source_kind == "proof_workspace" and document.source_ref_id is not None
        else None
    )

    preview_source = document.summary_text or document.content
    statement = " ".join(preview_source.split())[:220] or "No indexed code preview available yet."
    source_kind = workspace.source_kind if workspace is not None else document.source_kind
    status = workspace.status if workspace is not None else "indexed"

    return TheoremSummaryResponse(
        id=document.id,
        title=document.title,
        statement=statement,
        proof_language=document.language or "Lean4",
        is_verified=bool(document.is_verified),
        can_edit=bool(current_user and document.owner_id == current_user.id),
        source_kind=source_kind,
        status=status,
        updated_at=document.updated_at.isoformat(),
        path=document.path,
        module_name=document.module_name,
    )


def _get_document_or_404(
    db: Session,
    *,
    current_user: User,
    document_id: int,
) -> CodeDocument:
    document = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.id == document_id,
            CodeDocument.owner_id == current_user.id,
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
        .first()
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Indexed proof not found.")
    return document


def _get_backing_workspace(
    db: Session,
    *,
    current_user: User,
    document: CodeDocument,
) -> ProofWorkspace:
    if document.source_kind != "proof_workspace" or document.source_ref_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This code entry is not backed by a proof workspace.")

    workspace = (
        db.query(ProofWorkspace)
        .filter(
            ProofWorkspace.id == document.source_ref_id,
            ProofWorkspace.owner_id == current_user.id,
        )
        .first()
    )
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proof workspace not found.")
    return workspace


def _safe_delete_uploaded_file(file_path: str | None) -> None:
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


@router.get("/", response_model=list[TheoremSummaryResponse])
async def get_theorems(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[TheoremSummaryResponse]:
    if cleanup_missing_workspace_documents(db, settings=settings):
        db.commit()

    documents = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.is_verified.is_(True),
            CodeDocument.owner_id.isnot(None),
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
        .order_by(CodeDocument.updated_at.desc(), CodeDocument.id.desc())
        .all()
    )
    workspace_lookup = _build_workspace_lookup(db, documents)
    return [_build_summary(document, workspace_lookup, current_user) for document in documents]


@router.get("/{document_id}", response_model=TheoremDetailResponse)
async def get_theorem_detail(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TheoremDetailResponse:
    if cleanup_missing_workspace_documents(db, settings=settings):
        db.commit()

    document = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.id == document_id,
            CodeDocument.is_verified.is_(True),
            CodeDocument.owner_id.isnot(None),
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
        .first()
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Indexed proof not found.")

    workspace_lookup = _build_workspace_lookup(db, [document])
    summary = _build_summary(document, workspace_lookup, current_user)
    return TheoremDetailResponse(**summary.model_dump(), content=document.content)


@router.put("/{document_id}", response_model=TheoremDetailResponse)
async def update_theorem_detail(
    document_id: int,
    payload: TheoremUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TheoremDetailResponse:
    document = _get_document_or_404(db, current_user=current_user, document_id=document_id)
    title = payload.title.strip()
    content = payload.content
    saved_file = write_workspace_file(settings, code=content, title=title)

    try:
        await build_workspace_module(
            settings,
            relative_workspace_path=saved_file["path"],
            module_name=saved_file["module"],
        )
    except LeanWorkspaceError as exc:
        if saved_file["path"] != document.path:
            delete_workspace_file(settings, relative_path=saved_file["path"])
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    if document.source_kind == "proof_workspace":
        workspace = _get_backing_workspace(db, current_user=current_user, document=document)
        workspace.title = title
        workspace.lean4_code = content
        workspace.status = "edited"
        updated_document = await sync_proof_workspace_to_rag(
            db,
            settings=settings,
            workspace=workspace,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
            document=document,
        )
    else:
        updated_document = await sync_playground_document_to_rag(
            db,
            settings=settings,
            owner_id=current_user.id,
            title=title,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
            content=content,
            document=document,
        )

    db.commit()
    db.refresh(updated_document)
    workspace_lookup = _build_workspace_lookup(db, [updated_document])
    summary = _build_summary(updated_document, workspace_lookup, current_user)
    return TheoremDetailResponse(**summary.model_dump(), content=updated_document.content)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_theorem_detail(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    document = _get_document_or_404(db, current_user=current_user, document_id=document_id)

    if document.source_kind == "proof_workspace":
        workspace = _get_backing_workspace(db, current_user=current_user, document=document)
        _safe_delete_uploaded_file(workspace.pdf_path)
        db.delete(workspace)

    delete_indexed_document(
        db,
        settings=settings,
        document=document,
        remove_workspace_file=True,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
