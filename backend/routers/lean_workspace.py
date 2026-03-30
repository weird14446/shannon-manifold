from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.proof_workspace import ProofWorkspace
from models.user import User
from security import get_current_user, get_current_user_optional
from services.lean_workspace import (
    LeanWorkspaceError,
    build_workspace_module,
    build_workspace_module_sync,
    get_workspace_info,
    push_workspace_file_to_github,
    write_workspace_file,
)
from services.project_workspace import validate_project_context_copy
from services.rag_index import (
    build_import_graph,
)
from services.verified_build_jobs import enqueue_verified_build_job, get_verified_build_job

router = APIRouter(prefix="/lean-workspace", tags=["lean-workspace"])
settings = get_settings()


class LeanWorkspaceModule(BaseModel):
    path: str
    module: str


class LeanWorkspaceInfoResponse(BaseModel):
    workspace_dir: str
    playground_file: str
    playground_module: str
    repository_subdir: str
    repository_url: str | None
    repository_branch: str
    can_push: bool
    importable_modules: list[LeanWorkspaceModule]


class SyncPlaygroundRequest(BaseModel):
    code: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=255)
    proof_workspace_id: int | None = None
    project_root: str | None = None
    project_file_path: str | None = None
    validation_project_root: str | None = None
    validation_project_file_path: str | None = None
    remix_provenance: dict[str, Any] | None = None


class PushPlaygroundRequest(SyncPlaygroundRequest):
    commit_message: str | None = Field(default=None, max_length=255)


class SyncPlaygroundResponse(LeanWorkspaceInfoResponse):
    saved_path: str
    saved_module: str
    pushed: bool
    proof_workspace_id: int | None = None
    pdf_filename: str | None = None
    build_job_id: str | None = None
    build_status: str | None = None
    build_error: str | None = None
    remote_content_url: str | None = None
    remote_commit_url: str | None = None


class VerifiedBuildJobResponse(BaseModel):
    job_id: str
    status: str
    error: str | None = None
    saved_path: str
    saved_module: str
    proof_workspace_id: int | None = None
    pdf_filename: str | None = None
    created_at: str
    updated_at: str


class LeanImportGraphNode(BaseModel):
    id: str
    document_id: int
    label: str
    module_name: str
    path: str | None
    title: str
    imports: int
    cited_by_count: int = 0
    source_kind: str
    project_root: str | None = None
    project_slug: str | None = None
    project_title: str | None = None
    owner_slug: str | None = None


class LeanImportGraphLink(BaseModel):
    source: str
    target: str
    type: str


class LeanImportGraphResponse(BaseModel):
    nodes: list[LeanImportGraphNode]
    links: list[LeanImportGraphLink]


@router.get("/", response_model=LeanWorkspaceInfoResponse)
def read_lean_workspace_info() -> LeanWorkspaceInfoResponse:
    return LeanWorkspaceInfoResponse(**get_workspace_info(settings))


@router.get("/import-graph", response_model=LeanImportGraphResponse)
def read_lean_import_graph(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> LeanImportGraphResponse:
    owner_id = current_user.id if current_user else None
    graph = build_import_graph(db, settings=settings, owner_id=owner_id)
    return LeanImportGraphResponse(**graph)


@router.post("/sync-playground", response_model=SyncPlaygroundResponse)
async def sync_playground_file(
    payload: SyncPlaygroundRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncPlaygroundResponse:
    linked_workspace_id: int | None = None
    linked_pdf_filename: str | None = None
    try:
        saved_file = write_workspace_file(
            settings,
            code=payload.code,
            title=payload.title,
        )
    except LeanWorkspaceError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    workspace = None
    if payload.proof_workspace_id is not None:
        workspace = _get_backing_workspace(
            db,
            current_user=current_user,
            workspace_id=payload.proof_workspace_id,
        )
    if workspace is not None:
        workspace.title = payload.title
        workspace.lean4_code = payload.code
        workspace.status = "building"
        linked_workspace_id = workspace.id
        linked_pdf_filename = workspace.source_filename if workspace.pdf_path else None
    db.commit()
    queued_job = enqueue_verified_build_job(
        settings=settings,
        owner_id=current_user.id,
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        title=payload.title,
        code=payload.code,
        proof_workspace_id=linked_workspace_id,
        pdf_filename=linked_pdf_filename,
        project_root=payload.project_root,
        project_file_path=payload.project_file_path,
        validation_project_root=payload.validation_project_root,
        validation_project_file_path=payload.validation_project_file_path,
        remix_provenance=payload.remix_provenance,
        final_workspace_status="edited" if workspace is not None else None,
    )
    return SyncPlaygroundResponse(
        **get_workspace_info(settings, payload.title),
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        pushed=False,
        proof_workspace_id=linked_workspace_id,
        pdf_filename=linked_pdf_filename,
        build_job_id=str(queued_job["job_id"]),
        build_status=str(queued_job["status"]),
        build_error=queued_job["error"] if isinstance(queued_job["error"], str) else None,
    )


@router.post("/save-playground", response_model=SyncPlaygroundResponse)
async def save_playground_file_legacy(
    payload: SyncPlaygroundRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncPlaygroundResponse:
    # Backward-compatible alias for older frontend bundles still posting to
    # /lean-workspace/save-playground.
    return await sync_playground_file(payload, current_user=current_user, db=db)


@router.get("/build-jobs/{job_id}", response_model=VerifiedBuildJobResponse)
def read_verified_build_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> VerifiedBuildJobResponse:
    payload = get_verified_build_job(job_id, owner_id=current_user.id)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Build job not found.")
    return VerifiedBuildJobResponse(**payload)


@router.post("/push-playground", response_model=SyncPlaygroundResponse)
async def push_playground_file(
    payload: PushPlaygroundRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncPlaygroundResponse:
    linked_workspace_id: int | None = None
    linked_pdf_filename: str | None = None
    try:
        saved_file = write_workspace_file(
            settings,
            code=payload.code,
            title=payload.title,
        )
    except LeanWorkspaceError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    try:
        await build_workspace_module(
            settings,
            relative_workspace_path=saved_file["path"],
            module_name=saved_file["module"],
        )
    except LeanWorkspaceError as exc:
        if payload.project_root and payload.project_file_path:
            try:
                await validate_project_context_copy(
                    settings,
                    project_root=payload.project_root,
                    source_relative_path=payload.project_file_path,
                    content=payload.code,
                )
            except LeanWorkspaceError as project_exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(project_exc),
                ) from project_exc
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
    workspace = None
    if payload.proof_workspace_id is not None:
        workspace = _get_backing_workspace(
            db,
            current_user=current_user,
            workspace_id=payload.proof_workspace_id,
        )
    if workspace is not None:
        workspace.title = payload.title
        workspace.lean4_code = payload.code
        workspace.status = "edited"
        linked_workspace_id = workspace.id
        linked_pdf_filename = workspace.source_filename if workspace.pdf_path else None
        await sync_proof_workspace_to_rag(
            db,
            settings=settings,
            workspace=workspace,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
            project_root=payload.project_root,
            project_file_path=payload.project_file_path,
        )
    else:
        await sync_playground_document_to_rag(
            db,
            settings=settings,
            owner_id=current_user.id,
            title=payload.title,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
            content=payload.code,
            project_root=payload.project_root,
            project_file_path=payload.project_file_path,
        )
    db.commit()

    commit_message = payload.commit_message or (
        f"Update {saved_file['path']} from Shannon Playground by {current_user.full_name}"
    )

    pushed_file: dict[str, str | None] = {
        "repository_path": None,
        "content_url": None,
        "commit_url": None,
    }
    pushed = False

    if settings.github_repository_url and settings.github_access_token:
        try:
            pushed_file = await push_workspace_file_to_github(
                settings,
                relative_workspace_path=saved_file["path"],
                code=payload.code,
                commit_message=commit_message,
            )
            pushed = True
        except LeanWorkspaceError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    return SyncPlaygroundResponse(
        **get_workspace_info(settings, payload.title),
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        pushed=pushed,
        proof_workspace_id=linked_workspace_id,
        pdf_filename=linked_pdf_filename,
        remote_content_url=pushed_file["content_url"],
        remote_commit_url=pushed_file["commit_url"],
    )


def _get_backing_workspace(
    db: Session,
    *,
    current_user: User,
    workspace_id: int,
) -> ProofWorkspace | None:
    workspace = (
        db.query(ProofWorkspace)
        .filter(
            ProofWorkspace.id == workspace_id,
            ProofWorkspace.owner_id == current_user.id,
        )
        .first()
    )
    return workspace
