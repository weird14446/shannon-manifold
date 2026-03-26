from pathlib import Path
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.code_document import CodeDocument
from models.proof_workspace import ProofWorkspace
from models.user import User
from security import get_current_user, get_current_user_optional
from services.lean_workspace import LeanWorkspaceError, build_workspace_module, delete_workspace_file, write_workspace_file
from services.pdf_mapping import get_or_generate_pdf_mapping
from services.project_workspace import (
    accessible_project_roots,
    canonicalize_project_root,
    module_name_from_project_path,
)
from services.rag_index import (
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
    can_delete: bool
    source_kind: str
    status: str
    updated_at: str
    path: str | None
    module_name: str | None
    proof_workspace_id: int | None
    has_pdf: bool
    pdf_filename: str | None
    project_root: str | None = None
    project_slug: str | None = None
    project_title: str | None = None
    project_owner_slug: str | None = None
    project_file_path: str | None = None
    project_module_name: str | None = None


class TheoremDetailResponse(TheoremSummaryResponse):
    content: str


class TheoremPdfMappingItemResponse(BaseModel):
    symbol_name: str
    declaration_kind: str
    start_line: int
    end_line: int
    pdf_page: int | None = None
    pdf_excerpt: str
    confidence: float | None = None
    reason: str | None = None


class TheoremPdfMappingResponse(BaseModel):
    generated_at: str | None = None
    items: list[TheoremPdfMappingItemResponse]


class TheoremUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1)


def _normalize_project_file_path(path: str) -> str:
    return Path(path.strip().replace("\\", "/")).as_posix().lstrip("/")


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
    metadata: dict[str, object] = {}
    try:
        parsed_metadata = json.loads(document.metadata_json or "{}")
        if isinstance(parsed_metadata, dict):
            metadata = parsed_metadata
    except (TypeError, ValueError):
        metadata = {}

    workspace = (
        workspace_lookup.get(document.source_ref_id)
        if document.source_kind == "proof_workspace" and document.source_ref_id is not None
        else None
    )

    preview_source = document.summary_text or document.content
    statement = " ".join(preview_source.split())[:220] or "No indexed code preview available yet."
    source_kind = workspace.source_kind if workspace is not None else document.source_kind
    status = workspace.status if workspace is not None else "indexed"
    can_edit = bool(current_user and document.owner_id == current_user.id)
    can_delete = bool(
        current_user
        and (
            document.owner_id == current_user.id
            or bool(current_user.is_admin)
        )
    )

    return TheoremSummaryResponse(
        id=document.id,
        title=document.title,
        statement=statement,
        proof_language=document.language or "Lean4",
        is_verified=bool(document.is_verified),
        can_edit=can_edit,
        can_delete=can_delete,
        source_kind=source_kind,
        status=status,
        updated_at=document.updated_at.isoformat(),
        path=document.path,
        module_name=document.module_name,
        proof_workspace_id=workspace.id if workspace is not None else None,
        has_pdf=bool(workspace and workspace.pdf_path),
        pdf_filename=workspace.source_filename if workspace and workspace.pdf_path else None,
        project_root=str(metadata.get("project_root")) if metadata.get("project_root") else None,
        project_slug=str(metadata.get("project_slug")) if metadata.get("project_slug") else None,
        project_title=str(metadata.get("project_title")) if metadata.get("project_title") else None,
        project_owner_slug=str(metadata.get("owner_slug")) if metadata.get("owner_slug") else None,
        project_file_path=str(metadata.get("project_file_path")) if metadata.get("project_file_path") else None,
        project_module_name=str(metadata.get("project_module_name")) if metadata.get("project_module_name") else None,
    )


def _document_metadata(document: CodeDocument) -> dict[str, object]:
    try:
        parsed_metadata = json.loads(document.metadata_json or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed_metadata if isinstance(parsed_metadata, dict) else {}


def _document_is_visible(
    document: CodeDocument,
    *,
    visible_project_roots: set[str],
) -> bool:
    metadata = _document_metadata(document)
    project_root = metadata.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        return True
    return project_root in visible_project_roots


def _get_document_or_404(
    db: Session,
    *,
    current_user: User,
    document_id: int,
    allow_admin_delete: bool = False,
) -> CodeDocument:
    query = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.id == document_id,
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
    )
    if current_user.is_admin and allow_admin_delete:
        query = query.filter(CodeDocument.owner_id.isnot(None))
    else:
        query = query.filter(CodeDocument.owner_id == current_user.id)
    document = query.first()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Indexed proof not found.")
    return document


def _get_backing_workspace(
    db: Session,
    *,
    current_user: User,
    document: CodeDocument,
    allow_admin_delete: bool = False,
) -> ProofWorkspace:
    if document.source_kind != "proof_workspace" or document.source_ref_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This code entry is not backed by a proof workspace.")

    query = db.query(ProofWorkspace).filter(ProofWorkspace.id == document.source_ref_id)
    if current_user.is_admin and allow_admin_delete:
        query = query.filter(ProofWorkspace.owner_id.isnot(None))
    else:
        query = query.filter(ProofWorkspace.owner_id == current_user.id)
    workspace = query.first()
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
    visible_project_roots = accessible_project_roots(
        settings,
        requester_user_id=current_user.id if current_user else None,
    )
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
    documents = [
        document
        for document in documents
        if _document_is_visible(document, visible_project_roots=visible_project_roots)
    ]
    workspace_lookup = _build_workspace_lookup(db, documents)
    return [_build_summary(document, workspace_lookup, current_user) for document in documents]


@router.get("/lookup/project-module", response_model=TheoremSummaryResponse)
async def get_theorem_for_project_module(
    project_root: str = Query(min_length=1),
    project_file_path: str = Query(min_length=1),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TheoremSummaryResponse:
    normalized_project_root = canonicalize_project_root(project_root)
    visible_project_roots = accessible_project_roots(
        settings,
        requester_user_id=current_user.id if current_user else None,
    )
    if normalized_project_root not in visible_project_roots:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No verified database entry exists for this project module yet.",
        )
    normalized_project_file_path = _normalize_project_file_path(project_file_path)
    expected_module_name = module_name_from_project_path(normalized_project_file_path)
    expected_title = Path(normalized_project_file_path).stem

    candidate_documents = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.is_verified.is_(True),
            CodeDocument.owner_id.isnot(None),
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
            CodeDocument.metadata_json.contains(normalized_project_root),
        )
        .all()
    )

    best_match: tuple[int, CodeDocument] | None = None
    for document in candidate_documents:
        metadata = _document_metadata(document)
        if metadata.get("project_root") != normalized_project_root:
            continue

        score = 0
        if metadata.get("project_file_path") == normalized_project_file_path:
            score += 100
        if metadata.get("project_module_name") == expected_module_name:
            score += 80
        if document.title == expected_title:
            score += 40
        if document.module_name == expected_module_name:
            score += 20

        if score <= 0:
            continue
        if best_match is None or score > best_match[0]:
            best_match = (score, document)

    if best_match is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No verified database entry exists for this project module yet.",
        )

    document = best_match[1]
    workspace_lookup = _build_workspace_lookup(db, [document])
    return _build_summary(document, workspace_lookup, current_user)


@router.get("/{document_id}", response_model=TheoremDetailResponse)
async def get_theorem_detail(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TheoremDetailResponse:
    visible_project_roots = accessible_project_roots(
        settings,
        requester_user_id=current_user.id if current_user else None,
    )
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
    if not _document_is_visible(document, visible_project_roots=visible_project_roots):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Indexed proof not found.")

    workspace_lookup = _build_workspace_lookup(db, [document])
    summary = _build_summary(document, workspace_lookup, current_user)
    return TheoremDetailResponse(**summary.model_dump(), content=document.content)


@router.get("/{document_id}/pdf")
async def get_theorem_pdf(
    document_id: int,
    download: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> FileResponse:
    visible_project_roots = accessible_project_roots(
        settings,
        requester_user_id=current_user.id if current_user else None,
    )
    document = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.id == document_id,
            CodeDocument.is_verified.is_(True),
            CodeDocument.owner_id.isnot(None),
            CodeDocument.source_kind == "proof_workspace",
            CodeDocument.source_ref_id.isnot(None),
        )
        .first()
    )
    if document is None or document.source_ref_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF not found for this code entry.")
    if not _document_is_visible(document, visible_project_roots=visible_project_roots):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF not found for this code entry.")

    workspace = (
        db.query(ProofWorkspace)
        .filter(ProofWorkspace.id == document.source_ref_id)
        .first()
    )
    if workspace is None or not workspace.pdf_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF not found for this code entry.")

    pdf_path = Path(workspace.pdf_path)
    if not pdf_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF file is missing.")

    filename = workspace.source_filename or pdf_path.name
    content_disposition = "attachment" if download else "inline"
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'{content_disposition}; filename="{filename}"'},
    )


@router.get("/{document_id}/pdf-mapping", response_model=TheoremPdfMappingResponse)
async def get_theorem_pdf_mapping(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TheoremPdfMappingResponse:
    visible_project_roots = accessible_project_roots(
        settings,
        requester_user_id=current_user.id if current_user else None,
    )
    document = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.id == document_id,
            CodeDocument.is_verified.is_(True),
            CodeDocument.owner_id.isnot(None),
            CodeDocument.source_kind == "proof_workspace",
            CodeDocument.source_ref_id.isnot(None),
        )
        .first()
    )
    if document is None or document.source_ref_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF mapping not found for this code entry.")
    if not _document_is_visible(document, visible_project_roots=visible_project_roots):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF mapping not found for this code entry.")

    workspace = (
        db.query(ProofWorkspace)
        .filter(ProofWorkspace.id == document.source_ref_id)
        .first()
    )
    if workspace is None or not workspace.pdf_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF mapping not found for this code entry.")

    mapping = await get_or_generate_pdf_mapping(
        db,
        settings=settings,
        document=document,
        workspace=workspace,
    )
    db.commit()
    return TheoremPdfMappingResponse(**mapping)


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
    document = _get_document_or_404(
        db,
        current_user=current_user,
        document_id=document_id,
        allow_admin_delete=True,
    )

    if document.source_kind == "proof_workspace":
        workspace = _get_backing_workspace(
            db,
            current_user=current_user,
            document=document,
            allow_admin_delete=True,
        )
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
