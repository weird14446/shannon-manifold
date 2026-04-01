from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from config import Settings
from models.code_document import CodeDocument
from models.community_post import CommunityPost
from models.community_post_comment import CommunityPostComment
from models.user import User
from services.lean_workspace import LeanWorkspaceError
from services.project_workspace import (
    accessible_project_roots,
    canonicalize_project_root,
    get_accessible_project,
)
from services.rag_index import resolve_verified_document_identity

COMMUNITY_CATEGORIES = {"note", "theorem_review", "project_log", "paper", "essay"}
COMMUNITY_STATUSES = {"draft", "published"}
COMMUNITY_ARTIFACT_TYPES = {"theorem", "project"}
SLUG_SANITIZE_RE = re.compile(r"[^a-z0-9]+")


class CommunityValidationError(RuntimeError):
    pass


class CommunityNotFoundError(RuntimeError):
    pass


@dataclass(slots=True)
class CommunityArtifactSummary:
    artifact_type: str
    artifact_ref: str
    title: str
    subtitle: str
    theorem_id: int | None = None
    project_root: str | None = None
    project_slug: str | None = None
    project_owner_slug: str | None = None
    project_title: str | None = None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_json_list(raw_value: str | None) -> list[Any]:
    try:
        payload = json.loads(raw_value or "[]")
    except (TypeError, ValueError):
        return []
    return payload if isinstance(payload, list) else []


def dump_json_list(payload: list[Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=False)


def normalize_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        compact = " ".join(str(tag or "").strip().split())
        if not compact:
            continue
        lowered = compact.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(compact[:48])
    return normalized[:12]


def normalize_category(category: str) -> str:
    normalized = category.strip().lower()
    if normalized not in COMMUNITY_CATEGORIES:
        raise CommunityValidationError("Unsupported community post category.")
    return normalized


def slugify_title(title: str) -> str:
    compact = SLUG_SANITIZE_RE.sub("-", title.strip().lower()).strip("-")
    return compact[:80] or "post"


def ensure_unique_slug(
    db: Session,
    *,
    title: str,
    exclude_post_id: int | None = None,
) -> str:
    base_slug = slugify_title(title)
    slug = base_slug
    suffix = 2
    while True:
        query = db.query(CommunityPost).filter(CommunityPost.slug == slug)
        if exclude_post_id is not None:
            query = query.filter(CommunityPost.id != exclude_post_id)
        if query.first() is None:
            return slug
        slug = f"{base_slug}-{suffix}"
        suffix += 1


def _document_project_root(document: CodeDocument) -> str | None:
    try:
        metadata = json.loads(document.metadata_json or "{}")
    except (TypeError, ValueError):
        return None
    if not isinstance(metadata, dict):
        return None
    project_root = metadata.get("project_root")
    return str(project_root) if isinstance(project_root, str) and project_root.strip() else None


def _theorem_is_visible(
    document: CodeDocument,
    *,
    visible_project_roots: set[str],
) -> bool:
    project_root = _document_project_root(document)
    if not project_root:
        return True
    return project_root in visible_project_roots


def resolve_theorem_artifact(
    db: Session,
    *,
    settings: Settings,
    theorem_ref: str,
    requester_user_id: int | None,
) -> CommunityArtifactSummary:
    try:
        theorem_id = int(str(theorem_ref).strip())
    except (TypeError, ValueError) as exc:
        raise CommunityValidationError("Theorem links require a numeric theorem id.") from exc

    visible_project_roots = accessible_project_roots(settings, requester_user_id=requester_user_id)
    document = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.id == theorem_id,
            CodeDocument.is_verified.is_(True),
            CodeDocument.owner_id.isnot(None),
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
        .first()
    )
    if document is None or not _theorem_is_visible(document, visible_project_roots=visible_project_roots):
        raise CommunityNotFoundError("Linked theorem not found.")

    effective_module_name, effective_path, metadata = resolve_verified_document_identity(document)
    return CommunityArtifactSummary(
        artifact_type="theorem",
        artifact_ref=str(document.id),
        title=document.title,
        subtitle=effective_module_name or effective_path or document.path or "Verified theorem",
        theorem_id=document.id,
        project_root=str(metadata.get("project_root")) if metadata.get("project_root") else None,
        project_slug=str(metadata.get("project_slug")) if metadata.get("project_slug") else None,
        project_owner_slug=str(metadata.get("owner_slug")) if metadata.get("owner_slug") else None,
        project_title=str(metadata.get("project_title")) if metadata.get("project_title") else None,
    )


def resolve_project_artifact(
    *,
    db: Session,
    settings: Settings,
    project_ref: str,
    requester_user_id: int | None,
) -> CommunityArtifactSummary:
    try:
        canonical_root = canonicalize_project_root(project_ref)
        parts = canonical_root.split("/")
        if len(parts) < 3:
            raise LeanWorkspaceError("Project root is invalid.")
        project = get_accessible_project(
            settings,
            requester_user_id=requester_user_id,
            project_slug=parts[2],
            owner_slug=parts[1],
        )
    except LeanWorkspaceError as exc:
        raise CommunityNotFoundError("Linked project not found.") from exc

    return CommunityArtifactSummary(
        artifact_type="project",
        artifact_ref=str(project["project_root"]),
        title=str(project["title"]),
        subtitle=str(project["entry_module_name"]),
        project_root=str(project["project_root"]),
        project_slug=str(project["slug"]),
        project_owner_slug=str(project["owner_slug"]),
        project_title=str(project["title"]),
    )


def resolve_artifact_summary(
    db: Session,
    *,
    settings: Settings,
    artifact_type: str,
    artifact_ref: str,
    requester_user_id: int | None,
) -> CommunityArtifactSummary:
    normalized_type = artifact_type.strip().lower()
    if normalized_type not in COMMUNITY_ARTIFACT_TYPES:
        raise CommunityValidationError("Unsupported artifact type.")
    if normalized_type == "theorem":
        return resolve_theorem_artifact(
            db,
            settings=settings,
            theorem_ref=artifact_ref,
            requester_user_id=requester_user_id,
        )
    return resolve_project_artifact(
        db=db,
        settings=settings,
        project_ref=artifact_ref,
        requester_user_id=requester_user_id,
    )


def normalize_related_artifacts(
    artifacts: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    if not artifacts:
        return []
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in artifacts:
        if not isinstance(item, dict):
            raise CommunityValidationError("Related artifacts must be JSON objects.")
        artifact_type = str(item.get("artifact_type") or "").strip().lower()
        artifact_ref = str(item.get("artifact_ref") or "").strip()
        if artifact_type not in COMMUNITY_ARTIFACT_TYPES or not artifact_ref:
            raise CommunityValidationError("Each related artifact requires type and ref.")
        key = (artifact_type, artifact_ref)
        if key in seen:
            continue
        seen.add(key)
        normalized.append({"artifact_type": artifact_type, "artifact_ref": artifact_ref})
    return normalized[:12]


def validate_artifact_selection(
    db: Session,
    *,
    settings: Settings,
    requester_user_id: int | None,
    primary_artifact_type: str | None,
    primary_artifact_ref: str | None,
    related_artifacts: list[dict[str, str]],
) -> tuple[CommunityArtifactSummary | None, list[CommunityArtifactSummary]]:
    primary_summary = None
    if primary_artifact_type and primary_artifact_ref:
        primary_summary = resolve_artifact_summary(
            db,
            settings=settings,
            artifact_type=primary_artifact_type,
            artifact_ref=primary_artifact_ref,
            requester_user_id=requester_user_id,
        )

    related_summaries: list[CommunityArtifactSummary] = []
    for item in related_artifacts:
        summary = resolve_artifact_summary(
            db,
            settings=settings,
            artifact_type=item["artifact_type"],
            artifact_ref=item["artifact_ref"],
            requester_user_id=requester_user_id,
        )
        if (
            primary_summary is not None
            and summary.artifact_type == primary_summary.artifact_type
            and summary.artifact_ref == primary_summary.artifact_ref
        ):
            continue
        related_summaries.append(summary)
    return primary_summary, related_summaries


def comment_count_lookup(db: Session, post_ids: list[int]) -> dict[int, int]:
    if not post_ids:
        return {}
    rows = (
        db.query(CommunityPostComment.post_id, func.count(CommunityPostComment.id))
        .filter(CommunityPostComment.post_id.in_(post_ids))
        .group_by(CommunityPostComment.post_id)
        .all()
    )
    return {int(post_id): int(count) for post_id, count in rows}


def can_view_post(post: CommunityPost, current_user: User | None) -> bool:
    if post.status == "published":
        return True
    return bool(current_user and (current_user.is_admin or current_user.id == post.author_id))


def can_edit_post(post: CommunityPost, current_user: User | None) -> bool:
    return bool(current_user and (current_user.is_admin or current_user.id == post.author_id))


def can_feature_post(current_user: User | None) -> bool:
    return bool(current_user and current_user.is_admin)


def published_linkage_is_public(
    db: Session,
    *,
    settings: Settings,
    post: CommunityPost,
) -> bool:
    related_artifacts = normalize_related_artifacts(parse_json_list(post.related_artifacts_json))
    try:
        validate_artifact_selection(
            db,
            settings=settings,
            requester_user_id=None,
            primary_artifact_type=post.primary_artifact_type,
            primary_artifact_ref=post.primary_artifact_ref,
            related_artifacts=related_artifacts,
        )
    except (CommunityValidationError, CommunityNotFoundError):
        return False
    return True


def serialize_artifact(
    db: Session,
    *,
    settings: Settings,
    artifact_type: str,
    artifact_ref: str,
    requester_user_id: int | None,
) -> dict[str, Any] | None:
    try:
        summary = resolve_artifact_summary(
            db,
            settings=settings,
            artifact_type=artifact_type,
            artifact_ref=artifact_ref,
            requester_user_id=requester_user_id,
        )
    except (CommunityValidationError, CommunityNotFoundError):
        return None

    return {
        "artifact_type": summary.artifact_type,
        "artifact_ref": summary.artifact_ref,
        "title": summary.title,
        "subtitle": summary.subtitle,
        "theorem_id": summary.theorem_id,
        "project_root": summary.project_root,
        "project_slug": summary.project_slug,
        "project_owner_slug": summary.project_owner_slug,
        "project_title": summary.project_title,
    }


def serialize_post(
    db: Session,
    *,
    settings: Settings,
    post: CommunityPost,
    current_user: User | None,
    author_lookup: dict[int, User],
    comment_counts: dict[int, int] | None = None,
) -> dict[str, Any]:
    requester_user_id = current_user.id if current_user else None
    primary_artifact = None
    if post.primary_artifact_type and post.primary_artifact_ref:
        primary_artifact = serialize_artifact(
            db,
            settings=settings,
            artifact_type=post.primary_artifact_type,
            artifact_ref=post.primary_artifact_ref,
            requester_user_id=requester_user_id,
        )

    related_artifacts = []
    for item in normalize_related_artifacts(parse_json_list(post.related_artifacts_json)):
        serialized = serialize_artifact(
            db,
            settings=settings,
            artifact_type=item["artifact_type"],
            artifact_ref=item["artifact_ref"],
            requester_user_id=requester_user_id,
        )
        if serialized is not None:
            related_artifacts.append(serialized)

    author = author_lookup.get(post.author_id)
    return {
        "id": post.id,
        "author_id": post.author_id,
        "author_name": author.full_name if author is not None else f"User {post.author_id}",
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "content_markdown": post.content_markdown,
        "category": post.category,
        "tags": normalize_tags(parse_json_list(post.tags_json)),
        "status": post.status,
        "is_featured": bool(post.is_featured),
        "published_at": post.published_at.isoformat() if post.published_at else None,
        "created_at": post.created_at.isoformat(),
        "updated_at": post.updated_at.isoformat(),
        "primary_artifact": primary_artifact,
        "related_artifacts": related_artifacts,
        "comment_count": (comment_counts or {}).get(post.id, 0),
        "can_edit": can_edit_post(post, current_user),
        "can_delete": can_edit_post(post, current_user),
        "can_publish": can_edit_post(post, current_user),
        "can_feature": can_feature_post(current_user),
        "can_comment": current_user is not None and can_view_post(post, current_user),
    }


def build_author_lookup(db: Session, author_ids: set[int]) -> dict[int, User]:
    if not author_ids:
        return {}
    users = db.query(User).filter(User.id.in_(sorted(author_ids))).all()
    return {user.id: user for user in users}
