from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from config import get_settings
from models.user import User
from security import get_current_user
from services.lean_workspace import LeanWorkspaceError
from services.project_workspace import (
    create_project_file,
    ensure_user_project,
    get_user_project,
    list_user_projects,
    read_project_file,
    save_project_file,
)

router = APIRouter(prefix="/projects", tags=["projects"])
settings = get_settings()


class ProjectSummaryResponse(BaseModel):
    title: str
    slug: str
    owner_slug: str
    project_root: str
    package_name: str
    entry_file_path: str
    entry_module_name: str


class ProjectOpenResponse(ProjectSummaryResponse):
    workspace_title: str
    workspace_file_path: str
    workspace_module_name: str
    content: str


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    slug: str | None = Field(default=None, min_length=1, max_length=255)


class ProjectFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=512)


class ProjectSaveRequest(ProjectFileRequest):
    content: str = Field(default="")


def _to_open_response(project: dict[str, str], *, file_path: str, content: str) -> ProjectOpenResponse:
    normalized_file_path = Path(file_path).as_posix().lstrip("/")
    return ProjectOpenResponse(
        title=project["title"],
        slug=project["slug"],
        owner_slug=project["owner_slug"],
        project_root=project["project_root"],
        package_name=project["package_name"],
        entry_file_path=project["entry_file_path"],
        entry_module_name=project["entry_module_name"],
        workspace_title=Path(normalized_file_path).stem or project["title"],
        workspace_file_path=normalized_file_path,
        workspace_module_name=".".join(Path(normalized_file_path).with_suffix("").parts),
        content=content,
    )


@router.get("/", response_model=list[ProjectSummaryResponse])
def list_projects(current_user: User = Depends(get_current_user)) -> list[ProjectSummaryResponse]:
    projects = list_user_projects(settings, user_id=current_user.id)
    return [ProjectSummaryResponse(**project) for project in projects]


@router.post("/", response_model=ProjectOpenResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
) -> ProjectOpenResponse:
    project = ensure_user_project(
        settings,
        user_id=current_user.id,
        title=payload.title,
        slug=payload.slug,
    )
    content = read_project_file(
        settings,
        project_root=project["project_root"],
        relative_path=project["entry_file_path"],
    )
    return _to_open_response(project, file_path=project["entry_file_path"], content=content)


@router.get("/{project_slug}/open", response_model=ProjectOpenResponse)
def open_project(
    project_slug: str,
    file_path: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
) -> ProjectOpenResponse:
    try:
        project = get_user_project(
            settings,
            user_id=current_user.id,
            project_slug=project_slug,
        )
        target_file_path = file_path or project["entry_file_path"]
        content = read_project_file(
            settings,
            project_root=project["project_root"],
            relative_path=target_file_path,
        )
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return _to_open_response(project, file_path=target_file_path, content=content)


@router.post("/{project_slug}/files", response_model=ProjectOpenResponse, status_code=status.HTTP_201_CREATED)
def create_file_in_project(
    project_slug: str,
    payload: ProjectFileRequest,
    current_user: User = Depends(get_current_user),
) -> ProjectOpenResponse:
    try:
        project = get_user_project(
            settings,
            user_id=current_user.id,
            project_slug=project_slug,
        )
        created_file = create_project_file(
            settings,
            project_root=project["project_root"],
            package_name=project["package_name"],
            relative_path=payload.path,
        )
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return _to_open_response(
        project,
        file_path=created_file["workspace_file_path"],
        content=created_file["content"],
    )


@router.put("/{project_slug}/files", response_model=ProjectOpenResponse)
async def save_file_in_project(
    project_slug: str,
    payload: ProjectSaveRequest,
    current_user: User = Depends(get_current_user),
) -> ProjectOpenResponse:
    try:
        project = get_user_project(
            settings,
            user_id=current_user.id,
            project_slug=project_slug,
        )
        saved_file = await save_project_file(
            settings,
            project_root=project["project_root"],
            relative_path=payload.path,
            content=payload.content,
        )
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return _to_open_response(
        project,
        file_path=saved_file["workspace_file_path"],
        content=payload.content,
    )
