from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.user import User
from security import get_current_user, get_current_user_optional
from services.lean_workspace import LeanWorkspaceError
from services.project_workspace import (
    create_project_file,
    delete_project,
    get_accessible_project,
    get_project_by_owner_slug,
    ensure_user_project,
    get_user_project,
    list_accessible_projects,
    normalize_project_visibility,
    owner_slug_for_user,
    read_project_file,
    read_project_readme,
    save_project_file,
    update_user_project,
)
from services.rag_index import delete_project_index_documents, list_verified_project_modules

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
    github_url: str | None = None
    visibility: str
    can_edit: bool
    can_delete: bool


class ProjectOpenResponse(ProjectSummaryResponse):
    workspace_title: str
    workspace_file_path: str
    workspace_module_name: str
    content: str


class ProjectParticipantResponse(BaseModel):
    owner_slug: str
    display_name: str
    role: str


class ProjectDetailResponse(ProjectSummaryResponse):
    readme_path: str
    readme_content: str
    participants: list[ProjectParticipantResponse]


class ProjectModuleResponse(BaseModel):
    document_id: int
    path: str
    module_name: str
    title: str
    depth: int
    is_entry: bool


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    slug: str | None = Field(default=None, min_length=1, max_length=255)
    github_url: str | None = Field(default=None, max_length=1024)
    visibility: str = Field(default="private", max_length=16)


class ProjectUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    github_url: str | None = Field(default=None, max_length=1024)
    visibility: str | None = Field(default=None, max_length=16)
    readme_content: str | None = Field(default=None, max_length=200_000)


class ProjectFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=512)


class ProjectSaveRequest(ProjectFileRequest):
    content: str = Field(default="")


def _can_edit_project(project: dict[str, str | None], current_user: User | None) -> bool:
    return current_user is not None and project.get("owner_slug") == owner_slug_for_user(current_user.id)


def _can_delete_project(project: dict[str, str | None], current_user: User | None) -> bool:
    return bool(
        current_user
        and (
            project.get("owner_slug") == owner_slug_for_user(current_user.id)
            or current_user.is_admin
        )
    )


def _to_summary_response(
    project: dict[str, str | None],
    *,
    current_user: User | None,
) -> ProjectSummaryResponse:
    return ProjectSummaryResponse(
        title=str(project["title"]),
        slug=str(project["slug"]),
        owner_slug=str(project["owner_slug"]),
        project_root=str(project["project_root"]),
        package_name=str(project["package_name"]),
        entry_file_path=str(project["entry_file_path"]),
        entry_module_name=str(project["entry_module_name"]),
        github_url=project.get("github_url"),
        visibility=normalize_project_visibility(project.get("visibility")),
        can_edit=_can_edit_project(project, current_user),
        can_delete=_can_delete_project(project, current_user),
    )


def _to_open_response(
    project: dict[str, str | None],
    *,
    file_path: str,
    content: str,
    current_user: User | None,
) -> ProjectOpenResponse:
    normalized_file_path = Path(file_path).as_posix().lstrip("/")
    return ProjectOpenResponse(
        title=str(project["title"]),
        slug=str(project["slug"]),
        owner_slug=str(project["owner_slug"]),
        project_root=str(project["project_root"]),
        package_name=str(project["package_name"]),
        entry_file_path=str(project["entry_file_path"]),
        entry_module_name=str(project["entry_module_name"]),
        github_url=project.get("github_url"),
        visibility=normalize_project_visibility(project.get("visibility")),
        can_edit=_can_edit_project(project, current_user),
        can_delete=_can_delete_project(project, current_user),
        workspace_title=Path(normalized_file_path).stem or project["title"],
        workspace_file_path=normalized_file_path,
        workspace_module_name=".".join(Path(normalized_file_path).with_suffix("").parts),
        content=content,
    )


def _project_owner_user(project: dict[str, str | None], db: Session) -> User | None:
    owner_slug = str(project.get("owner_slug") or "")
    if not owner_slug.startswith("user"):
        return None

    try:
        owner_id = int(owner_slug.removeprefix("user"))
    except ValueError:
        return None

    return db.query(User).filter(User.id == owner_id).first()


def _to_detail_response(
    project: dict[str, str | None],
    *,
    current_user: User | None,
    db: Session,
) -> ProjectDetailResponse:
    readme_path, readme_content = read_project_readme(
        settings,
        project_root=str(project["project_root"]),
    )
    owner_user = _project_owner_user(project, db)
    display_name = owner_user.full_name if owner_user is not None else str(project["owner_slug"])
    return ProjectDetailResponse(
        **_to_summary_response(project, current_user=current_user).model_dump(),
        readme_path=readme_path,
        readme_content=readme_content,
        participants=[
            ProjectParticipantResponse(
                owner_slug=str(project["owner_slug"]),
                display_name=display_name,
                role="Owner",
            )
        ],
    )


@router.get("/", response_model=list[ProjectSummaryResponse])
def list_projects(
    current_user: User | None = Depends(get_current_user_optional),
) -> list[ProjectSummaryResponse]:
    projects = list_accessible_projects(
        settings,
        requester_user_id=current_user.id if current_user else None,
    )
    return [_to_summary_response(project, current_user=current_user) for project in projects]


@router.get("/{project_slug}", response_model=ProjectDetailResponse)
def get_project_detail(
    project_slug: str,
    owner_slug: str | None = Query(default=None),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> ProjectDetailResponse:
    try:
        project = get_accessible_project(
            settings,
            requester_user_id=current_user.id if current_user else None,
            project_slug=project_slug,
            owner_slug=owner_slug,
        )
        return _to_detail_response(project, current_user=current_user, db=db)
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.post("/", response_model=ProjectOpenResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
) -> ProjectOpenResponse:
    try:
        project = ensure_user_project(
            settings,
            user_id=current_user.id,
            title=payload.title,
            slug=payload.slug,
            github_url=payload.github_url,
            visibility=payload.visibility,
        )
        content = read_project_file(
            settings,
            project_root=str(project["project_root"]),
            relative_path=str(project["entry_file_path"]),
        )
    except LeanWorkspaceError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _to_open_response(
        project,
        file_path=str(project["entry_file_path"]),
        content=content,
        current_user=current_user,
    )


@router.put("/{project_slug}", response_model=ProjectDetailResponse)
def update_project(
    project_slug: str,
    payload: ProjectUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectDetailResponse:
    try:
        project = update_user_project(
            settings,
            user_id=current_user.id,
            project_slug=project_slug,
            title=payload.title,
            github_url=payload.github_url,
            visibility=payload.visibility,
            readme_content=payload.readme_content,
        )
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return _to_detail_response(project, current_user=current_user, db=db)


@router.delete("/{project_slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_detail(
    project_slug: str,
    owner_slug: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    requested_owner_slug = owner_slug.strip() if owner_slug else None
    current_owner_slug = owner_slug_for_user(current_user.id)

    try:
        if current_user.is_admin and requested_owner_slug:
            project = get_project_by_owner_slug(
                settings,
                owner_slug=requested_owner_slug,
                project_slug=project_slug,
            )
        else:
            if requested_owner_slug and requested_owner_slug != current_owner_slug:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only delete your own projects.",
                )
            project = get_user_project(
                settings,
                user_id=current_user.id,
                project_slug=project_slug,
            )

        delete_project_index_documents(
            db,
            settings=settings,
            project_root=str(project["project_root"]),
        )
        delete_project(
            settings,
            owner_slug=str(project["owner_slug"]),
            project_slug=str(project["slug"]),
        )
        db.commit()
    except HTTPException:
        raise
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_slug}/open", response_model=ProjectOpenResponse)
def open_project(
    project_slug: str,
    file_path: str | None = Query(default=None),
    owner_slug: str | None = Query(default=None),
    current_user: User | None = Depends(get_current_user_optional),
) -> ProjectOpenResponse:
    try:
        project = get_accessible_project(
            settings,
            requester_user_id=current_user.id if current_user else None,
            project_slug=project_slug,
            owner_slug=owner_slug,
        )
        target_file_path = file_path or project["entry_file_path"]
        content = read_project_file(
            settings,
            project_root=str(project["project_root"]),
            relative_path=str(target_file_path),
        )
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return _to_open_response(
        project,
        file_path=str(target_file_path),
        content=content,
        current_user=current_user,
    )


@router.get("/{project_slug}/modules", response_model=list[ProjectModuleResponse])
def get_project_modules(
    project_slug: str,
    owner_slug: str | None = Query(default=None),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[ProjectModuleResponse]:
    try:
        project = get_accessible_project(
            settings,
            requester_user_id=current_user.id if current_user else None,
            project_slug=project_slug,
            owner_slug=owner_slug,
        )
        modules = list_verified_project_modules(
            db,
            project_root=str(project["project_root"]),
            package_name=str(project["package_name"]),
            entry_file_path=str(project["entry_file_path"]),
        )
    except LeanWorkspaceError as exc:
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return [ProjectModuleResponse(**module) for module in modules]


@router.post("/{project_slug}/files", response_model=ProjectOpenResponse, status_code=status.HTTP_201_CREATED)
async def create_file_in_project(
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
        current_user=current_user,
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
        current_user=current_user,
    )
