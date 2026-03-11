from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from config import get_settings
from models.user import User
from security import get_current_user
from services.lean_workspace import (
    LeanWorkspaceError,
    get_workspace_info,
    push_workspace_file_to_github,
    write_workspace_file,
)

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


@router.get("/", response_model=LeanWorkspaceInfoResponse)
def read_lean_workspace_info() -> LeanWorkspaceInfoResponse:
    return LeanWorkspaceInfoResponse(**get_workspace_info(settings))


@router.post("/sync-playground", response_model=SyncPlaygroundResponse)
def sync_playground_file(
    payload: SyncPlaygroundRequest,
    current_user: User = Depends(get_current_user),
) -> SyncPlaygroundResponse:
    del current_user
    saved_file = write_workspace_file(
        settings,
        code=payload.code,
        relative_path=settings.lean_playground_file,
    )
    return SyncPlaygroundResponse(
        **get_workspace_info(settings),
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        pushed=False,
    )


@router.post("/push-playground", response_model=SyncPlaygroundResponse)
async def push_playground_file(
    payload: PushPlaygroundRequest,
    current_user: User = Depends(get_current_user),
) -> SyncPlaygroundResponse:
    saved_file = write_workspace_file(
        settings,
        code=payload.code,
        relative_path=settings.lean_playground_file,
    )

    commit_message = payload.commit_message or (
        f"Update {saved_file['path']} from Shannon Playground by {current_user.full_name}"
    )

    try:
        pushed_file = await push_workspace_file_to_github(
            settings,
            relative_workspace_path=saved_file["path"],
            code=payload.code,
            commit_message=commit_message,
        )
    except LeanWorkspaceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return SyncPlaygroundResponse(
        **get_workspace_info(settings),
        saved_path=saved_file["path"],
        saved_module=saved_file["module"],
        pushed=True,
        remote_content_url=pushed_file["content_url"],
        remote_commit_url=pushed_file["commit_url"],
    )
