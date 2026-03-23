from collections import Counter
from datetime import datetime
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.code_document import CodeDocument
from models.proof_workspace import ProofWorkspace
from models.user import User
from security import get_current_admin_user
from services.project_workspace import (
    delete_project,
    list_all_projects,
    owner_slug_for_user,
)
from services.rag_index import delete_indexed_document, delete_project_index_documents

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()


class AdminStatsResponse(BaseModel):
    total_users: int
    admin_users: int
    total_projects: int
    public_projects: int
    private_projects: int
    verified_documents: int
    proof_workspaces: int
    pdf_workspaces: int


class AdminUserSummaryResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    is_admin: bool
    created_at: datetime
    project_count: int
    verified_document_count: int
    proof_workspace_count: int
    pdf_workspace_count: int
    can_toggle_admin: bool

    model_config = ConfigDict(from_attributes=True)


class AdminProjectSummaryResponse(BaseModel):
    title: str
    slug: str
    owner_slug: str
    project_root: str
    package_name: str
    entry_module_name: str
    github_url: str | None = None
    visibility: str


class AdminOverviewResponse(BaseModel):
    stats: AdminStatsResponse
    users: list[AdminUserSummaryResponse]
    projects: list[AdminProjectSummaryResponse]


class AdminUserUpdateRequest(BaseModel):
    is_admin: bool


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


def _clear_deleted_owner_metadata(db: Session, *, owner_slug: str) -> None:
    candidate_documents = (
        db.query(CodeDocument)
        .filter(CodeDocument.metadata_json.contains(owner_slug))
        .all()
    )
    for document in candidate_documents:
        try:
            metadata = json.loads(document.metadata_json or "{}")
        except (TypeError, ValueError):
            continue
        if not isinstance(metadata, dict):
            continue
        if metadata.get("owner_slug") != owner_slug:
            continue
        metadata.pop("project_root", None)
        metadata.pop("project_slug", None)
        metadata.pop("project_title", None)
        metadata.pop("owner_slug", None)
        document.metadata_json = json.dumps(metadata)
    db.flush()


def _delete_owned_projects(db: Session, *, owner_slug: str) -> int:
    projects = [project for project in list_all_projects(settings) if project.get("owner_slug") == owner_slug]
    for project in projects:
        delete_project_index_documents(
            db,
            settings=settings,
            project_root=str(project["project_root"]),
        )
        delete_project(
            settings,
            owner_slug=owner_slug,
            project_slug=str(project["slug"]),
        )
    return len(projects)


def _build_user_summary(
    user: User,
    *,
    admin_count: int,
    project_counts: Counter[str],
    document_counts: dict[int, int],
    workspace_counts: dict[int, int],
    pdf_workspace_counts: dict[int, int],
) -> AdminUserSummaryResponse:
    return AdminUserSummaryResponse(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        is_admin=bool(user.is_admin),
        created_at=user.created_at,
        project_count=project_counts.get(owner_slug_for_user(user.id), 0),
        verified_document_count=document_counts.get(user.id, 0),
        proof_workspace_count=workspace_counts.get(user.id, 0),
        pdf_workspace_count=pdf_workspace_counts.get(user.id, 0),
        can_toggle_admin=(not user.is_admin) or admin_count > 1,
    )


def _build_count_map(rows: list[tuple[int, int]]) -> dict[int, int]:
    return {int(owner_id): int(count) for owner_id, count in rows if owner_id is not None}


@router.get("/overview", response_model=AdminOverviewResponse)
def get_admin_overview(
    _: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> AdminOverviewResponse:
    users = (
        db.query(User)
        .order_by(User.is_admin.desc(), User.created_at.desc(), User.id.desc())
        .all()
    )
    projects = list_all_projects(settings)
    project_counts = Counter(
        str(project.get("owner_slug"))
        for project in projects
        if project.get("owner_slug")
    )
    document_counts = _build_count_map(
        db.query(CodeDocument.owner_id, func.count(CodeDocument.id))
        .filter(
            CodeDocument.owner_id.isnot(None),
            CodeDocument.is_verified.is_(True),
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
        .group_by(CodeDocument.owner_id)
        .all()
    )
    workspace_counts = _build_count_map(
        db.query(ProofWorkspace.owner_id, func.count(ProofWorkspace.id))
        .filter(ProofWorkspace.owner_id.isnot(None))
        .group_by(ProofWorkspace.owner_id)
        .all()
    )
    pdf_workspace_counts = _build_count_map(
        db.query(ProofWorkspace.owner_id, func.count(ProofWorkspace.id))
        .filter(
            ProofWorkspace.owner_id.isnot(None),
            ProofWorkspace.pdf_path.isnot(None),
        )
        .group_by(ProofWorkspace.owner_id)
        .all()
    )
    admin_count = sum(1 for user in users if user.is_admin)

    return AdminOverviewResponse(
        stats=AdminStatsResponse(
            total_users=len(users),
            admin_users=admin_count,
            total_projects=len(projects),
            public_projects=sum(1 for project in projects if project.get("visibility") == "public"),
            private_projects=sum(1 for project in projects if project.get("visibility") != "public"),
            verified_documents=sum(document_counts.values()),
            proof_workspaces=sum(workspace_counts.values()),
            pdf_workspaces=sum(pdf_workspace_counts.values()),
        ),
        users=[
            _build_user_summary(
                user,
                admin_count=admin_count,
                project_counts=project_counts,
                document_counts=document_counts,
                workspace_counts=workspace_counts,
                pdf_workspace_counts=pdf_workspace_counts,
            )
            for user in users
        ],
        projects=[
            AdminProjectSummaryResponse(
                title=str(project["title"]),
                slug=str(project["slug"]),
                owner_slug=str(project["owner_slug"]),
                project_root=str(project["project_root"]),
                package_name=str(project["package_name"]),
                entry_module_name=str(project["entry_module_name"]),
                github_url=project.get("github_url"),
                visibility=str(project.get("visibility") or "private"),
            )
            for project in projects
        ],
    )


@router.put("/users/{user_id}", response_model=AdminUserSummaryResponse)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdateRequest,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> AdminUserSummaryResponse:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    admin_count = int(
        db.query(func.count(User.id))
        .filter(User.is_admin.is_(True))
        .scalar()
        or 0
    )
    if user.is_admin and not payload.is_admin and admin_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one administrator account must remain.",
        )

    if user.id == current_admin.id and user.is_admin and not payload.is_admin and admin_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="You cannot remove the last administrator account.",
        )

    if user.is_admin != payload.is_admin:
        user.is_admin = payload.is_admin
        db.commit()
        db.refresh(user)
        admin_count = int(
            db.query(func.count(User.id))
            .filter(User.is_admin.is_(True))
            .scalar()
            or 0
        )

    projects = list_all_projects(settings)
    project_counts = Counter(
        str(project.get("owner_slug"))
        for project in projects
        if project.get("owner_slug")
    )
    document_counts = _build_count_map(
        db.query(CodeDocument.owner_id, func.count(CodeDocument.id))
        .filter(
            CodeDocument.owner_id.isnot(None),
            CodeDocument.is_verified.is_(True),
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
        .group_by(CodeDocument.owner_id)
        .all()
    )
    workspace_counts = _build_count_map(
        db.query(ProofWorkspace.owner_id, func.count(ProofWorkspace.id))
        .filter(ProofWorkspace.owner_id.isnot(None))
        .group_by(ProofWorkspace.owner_id)
        .all()
    )
    pdf_workspace_counts = _build_count_map(
        db.query(ProofWorkspace.owner_id, func.count(ProofWorkspace.id))
        .filter(
            ProofWorkspace.owner_id.isnot(None),
            ProofWorkspace.pdf_path.isnot(None),
        )
        .group_by(ProofWorkspace.owner_id)
        .all()
    )

    return _build_user_summary(
        user,
        admin_count=admin_count,
        project_counts=project_counts,
        document_counts=document_counts,
        workspace_counts=workspace_counts,
        pdf_workspace_counts=pdf_workspace_counts,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_user(
    user_id: int,
    current_admin: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> None:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Administrators cannot delete their own account from the admin page.",
        )

    admin_count = int(
        db.query(func.count(User.id))
        .filter(User.is_admin.is_(True))
        .scalar()
        or 0
    )
    if user.is_admin and admin_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one administrator account must remain.",
        )

    owner_slug = owner_slug_for_user(user.id)
    _delete_owned_projects(db, owner_slug=owner_slug)

    workspace_documents = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.owner_id == user.id,
            CodeDocument.source_kind == "proof_workspace",
            CodeDocument.source_ref_id.isnot(None),
        )
        .all()
    )
    workspace_document_map = {
        int(document.source_ref_id): document
        for document in workspace_documents
        if document.source_ref_id is not None
    }
    workspaces = db.query(ProofWorkspace).filter(ProofWorkspace.owner_id == user.id).all()
    for workspace in workspaces:
        document = workspace_document_map.get(workspace.id)
        if document is not None:
            delete_indexed_document(
                db,
                settings=settings,
                document=document,
                remove_workspace_file=True,
            )
        _safe_delete_uploaded_file(workspace.pdf_path)
        db.delete(workspace)

    remaining_documents = db.query(CodeDocument).filter(CodeDocument.owner_id == user.id).all()
    for document in remaining_documents:
        delete_indexed_document(
            db,
            settings=settings,
            document=document,
            remove_workspace_file=document.source_kind != "project",
        )

    _clear_deleted_owner_metadata(db, owner_slug=owner_slug)

    db.delete(user)
    db.commit()
