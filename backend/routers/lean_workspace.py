from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
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
from services.rag_index import build_import_graph, cleanup_missing_workspace_documents, sync_playground_document_to_rag

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


class PushPlaygroundRequest(SyncPlaygroundRequest):
    commit_message: str | None = Field(default=None, max_length=255)


class SyncPlaygroundResponse(LeanWorkspaceInfoResponse):
    saved_path: str
    saved_module: str
    pushed: bool
    remote_content_url: str | None = None
    remote_commit_url: str | None = None


class LeanImportGraphNode(BaseModel):
    id: str
    label: str
    module_name: str
    path: str | None
    title: str
    imports: int
    source_kind: str


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
    if cleanup_missing_workspace_documents(db, settings=settings):
        db.commit()

    owner_id = current_user.id if current_user else None
    graph = build_import_graph(db, owner_id=owner_id)
    return LeanImportGraphResponse(**graph)


@router.post("/sync-playground", response_model=SyncPlaygroundResponse)
def sync_playground_file(
    payload: SyncPlaygroundRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncPlaygroundResponse:
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
        build_workspace_module_sync(
            settings,
            relative_workspace_path=saved_file["path"],
            module_name=saved_file["module"],
        )
    except LeanWorkspaceError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    asyncio.run(
        sync_playground_document_to_rag(
            db,
            settings=settings,
            owner_id=current_user.id,
            title=payload.title,
            saved_path=saved_file["path"],
            saved_module=saved_file["module"],
            content=payload.code,
        )
    )
    db.commit()
    return SyncPlaygroundResponse(
        **get_workspace_info(settings, payload.title),
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        pushed=False,
    )


@router.post("/push-playground", response_model=SyncPlaygroundResponse)
async def push_playground_file(
    payload: PushPlaygroundRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncPlaygroundResponse:
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
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    await sync_playground_document_to_rag(
        db,
        settings=settings,
        owner_id=current_user.id,
        title=payload.title,
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        content=payload.code,
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
        remote_content_url=pushed_file["content_url"],
        remote_commit_url=pushed_file["commit_url"],
    )
