from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.community_post import CommunityPost
from models.community_post_comment import CommunityPostComment
from models.user import User
from security import get_current_admin_user, get_current_user, get_current_user_optional
from services.community import (
    COMMUNITY_CATEGORIES,
    COMMUNITY_STATUSES,
    CommunityNotFoundError,
    CommunityValidationError,
    build_author_lookup,
    can_edit_post,
    can_view_post,
    comment_count_lookup,
    dump_json_list,
    ensure_unique_slug,
    normalize_category,
    normalize_related_artifacts,
    normalize_tags,
    now_utc,
    parse_json_list,
    published_linkage_is_public,
    serialize_post,
    validate_artifact_selection,
)

router = APIRouter(prefix="/community", tags=["community"])
settings = get_settings()


class CommunityArtifactPayload(BaseModel):
    artifact_type: str = Field(min_length=1, max_length=32)
    artifact_ref: str = Field(min_length=1, max_length=512)


class CommunityArtifactResponse(BaseModel):
    artifact_type: str
    artifact_ref: str
    title: str
    subtitle: str
    theorem_id: int | None = None
    project_root: str | None = None
    project_slug: str | None = None
    project_owner_slug: str | None = None
    project_title: str | None = None


class CommunityPostSummaryResponse(BaseModel):
    id: int
    author_id: int
    author_name: str
    title: str
    slug: str
    summary: str
    category: str
    tags: list[str]
    status: str
    is_featured: bool
    published_at: str | None = None
    created_at: str
    updated_at: str
    primary_artifact: CommunityArtifactResponse | None = None
    related_artifacts: list[CommunityArtifactResponse]
    comment_count: int
    can_edit: bool
    can_delete: bool
    can_publish: bool
    can_feature: bool
    can_comment: bool


class CommunityPostDetailResponse(CommunityPostSummaryResponse):
    content_markdown: str


class CommunityPostCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    summary: str = Field(default="", max_length=1_200)
    content_markdown: str = Field(min_length=1, max_length=200_000)
    category: str = Field(min_length=1, max_length=32)
    tags: list[str] = Field(default_factory=list)
    primary_artifact: CommunityArtifactPayload | None = None
    related_artifacts: list[CommunityArtifactPayload] = Field(default_factory=list)


class CommunityPostUpdateRequest(CommunityPostCreateRequest):
    pass


class CommunityPublishRequest(BaseModel):
    published: bool = True


class CommunityFeatureRequest(BaseModel):
    is_featured: bool


class CommunityPostCommentResponse(BaseModel):
    id: int
    post_id: int
    author_id: int
    author_name: str
    parent_id: int | None = None
    parent_author_name: str | None = None
    body: str
    created_at: str
    updated_at: str
    can_delete: bool


class CommunityPostCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_id: int | None = None


def _post_or_404(db: Session, post_id: int) -> CommunityPost:
    post = db.query(CommunityPost).filter(CommunityPost.id == post_id).first()
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community post not found.")
    return post


def _post_by_slug_or_404(db: Session, slug: str) -> CommunityPost:
    post = db.query(CommunityPost).filter(CommunityPost.slug == slug).first()
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community post not found.")
    return post


def _comment_or_404(db: Session, comment_id: int) -> CommunityPostComment:
    comment = db.query(CommunityPostComment).filter(CommunityPostComment.id == comment_id).first()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community comment not found.")
    return comment


def _ensure_viewable(post: CommunityPost, current_user: User | None) -> None:
    if can_view_post(post, current_user):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community post not found.")


def _serialize_comment_rows(
    db: Session,
    comments: list[CommunityPostComment],
    *,
    current_user: User | None,
) -> list[CommunityPostCommentResponse]:
    if not comments:
        return []
    author_lookup = build_author_lookup(db, {comment.author_id for comment in comments})
    comment_lookup = {comment.id: comment for comment in comments}
    return [
        CommunityPostCommentResponse(
            id=comment.id,
            post_id=comment.post_id,
            author_id=comment.author_id,
            author_name=author_lookup.get(comment.author_id).full_name
            if author_lookup.get(comment.author_id) is not None
            else f"User {comment.author_id}",
            parent_id=comment.parent_id,
            parent_author_name=(
                author_lookup.get(comment_lookup[comment.parent_id].author_id).full_name
                if comment.parent_id is not None
                and comment.parent_id in comment_lookup
                and author_lookup.get(comment_lookup[comment.parent_id].author_id) is not None
                else None
            ),
            body=comment.body,
            created_at=comment.created_at.isoformat(),
            updated_at=comment.updated_at.isoformat(),
            can_delete=bool(
                current_user
                and (current_user.is_admin or current_user.id == comment.author_id)
            ),
        )
        for comment in comments
    ]


def _community_post_response(
    db: Session,
    *,
    post: CommunityPost,
    current_user: User | None,
    comment_counts: dict[int, int] | None = None,
) -> CommunityPostDetailResponse:
    author_lookup = build_author_lookup(db, {post.author_id})
    serialized = serialize_post(
        db,
        settings=settings,
        post=post,
        current_user=current_user,
        author_lookup=author_lookup,
        comment_counts=comment_counts,
    )
    return CommunityPostDetailResponse(**serialized)


def _normalize_payload_links(
    db: Session,
    *,
    payload: CommunityPostCreateRequest | CommunityPostUpdateRequest,
    requester_user_id: int | None,
) -> tuple[CommunityArtifactPayload | None, list[dict[str, str]]]:
    primary = payload.primary_artifact
    related = normalize_related_artifacts(
        [item.model_dump() for item in payload.related_artifacts]
        if payload.related_artifacts
        else []
    )
    validate_artifact_selection(
        db,
        settings=settings,
        requester_user_id=requester_user_id,
        primary_artifact_type=primary.artifact_type if primary else None,
        primary_artifact_ref=primary.artifact_ref if primary else None,
        related_artifacts=related,
    )
    return primary, related


@router.get("/posts", response_model=list[CommunityPostSummaryResponse])
def list_community_posts(
    category: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    featured_only: bool = Query(default=False),
    author_id: int | None = Query(default=None, ge=1),
    linked_type: str | None = Query(default=None),
    linked_ref: str | None = Query(default=None),
    search: str | None = Query(default=None),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[CommunityPostSummaryResponse]:
    query = db.query(CommunityPost)
    normalized_status = status_value.strip().lower() if status_value else None
    if normalized_status is None:
        normalized_status = "published"
    if normalized_status not in COMMUNITY_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported post status.")

    if normalized_status == "draft":
        if current_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
        query = query.filter(CommunityPost.status == "draft")
        if not current_user.is_admin:
            query = query.filter(CommunityPost.author_id == current_user.id)
    else:
        query = query.filter(CommunityPost.status == "published")

    if author_id is not None:
        query = query.filter(CommunityPost.author_id == author_id)
    if featured_only:
        query = query.filter(CommunityPost.is_featured.is_(True))
    if category:
        query = query.filter(CommunityPost.category == normalize_category(category))
    if search:
        needle = f"%{search.strip()}%"
        query = query.filter(
            or_(
                CommunityPost.title.ilike(needle),
                CommunityPost.summary.ilike(needle),
                CommunityPost.content_markdown.ilike(needle),
            )
        )

    if normalized_status == "published":
        query = query.order_by(
            CommunityPost.is_featured.desc(),
            CommunityPost.published_at.is_(None).asc(),
            CommunityPost.published_at.desc(),
            CommunityPost.updated_at.desc(),
        )
    else:
        query = query.order_by(CommunityPost.updated_at.desc(), CommunityPost.id.desc())

    posts = query.all()

    if tag:
        lowered_tag = tag.strip().lower()
        posts = [
            post
            for post in posts
            if lowered_tag in {item.lower() for item in normalize_tags(parse_json_list(post.tags_json))}
        ]

    if linked_type or linked_ref:
        normalized_linked_type = linked_type.strip().lower() if linked_type else None
        if normalized_linked_type and normalized_linked_type not in {"theorem", "project"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unsupported linked artifact type.",
            )
        filtered_posts: list[CommunityPost] = []
        for post in posts:
            if normalized_linked_type and post.primary_artifact_type == normalized_linked_type and (
                linked_ref is None or post.primary_artifact_ref == linked_ref
            ):
                filtered_posts.append(post)
                continue
            related = normalize_related_artifacts(parse_json_list(post.related_artifacts_json))
            if any(
                (normalized_linked_type is None or item["artifact_type"] == normalized_linked_type)
                and (linked_ref is None or item["artifact_ref"] == linked_ref)
                for item in related
            ):
                filtered_posts.append(post)
        posts = filtered_posts

    author_lookup = build_author_lookup(db, {post.author_id for post in posts})
    comment_counts = comment_count_lookup(db, [post.id for post in posts])
    return [
        CommunityPostSummaryResponse(
            **serialize_post(
                db,
                settings=settings,
                post=post,
                current_user=current_user,
                author_lookup=author_lookup,
                comment_counts=comment_counts,
            )
        )
        for post in posts
    ]


@router.get("/posts/{post_id}", response_model=CommunityPostDetailResponse)
def get_community_post(
    post_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> CommunityPostDetailResponse:
    post = _post_or_404(db, post_id)
    _ensure_viewable(post, current_user)
    return _community_post_response(
        db,
        post=post,
        current_user=current_user,
        comment_counts=comment_count_lookup(db, [post.id]),
    )


@router.get("/posts/slug/{slug}", response_model=CommunityPostDetailResponse)
def get_community_post_by_slug(
    slug: str,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> CommunityPostDetailResponse:
    post = _post_by_slug_or_404(db, slug)
    _ensure_viewable(post, current_user)
    return _community_post_response(
        db,
        post=post,
        current_user=current_user,
        comment_counts=comment_count_lookup(db, [post.id]),
    )


@router.post("/posts", response_model=CommunityPostDetailResponse, status_code=status.HTTP_201_CREATED)
def create_community_post(
    payload: CommunityPostCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CommunityPostDetailResponse:
    try:
        normalized_category = normalize_category(payload.category)
        primary, related = _normalize_payload_links(
            db,
            payload=payload,
            requester_user_id=current_user.id,
        )
    except (CommunityValidationError, CommunityNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    post = CommunityPost(
        author_id=current_user.id,
        title=payload.title.strip(),
        slug=ensure_unique_slug(db, title=payload.title.strip()),
        summary=payload.summary.strip(),
        content_markdown=payload.content_markdown.strip(),
        category=normalized_category,
        tags_json=dump_json_list(normalize_tags(payload.tags)),
        status="draft",
        is_featured=False,
        primary_artifact_type=primary.artifact_type if primary else None,
        primary_artifact_ref=primary.artifact_ref if primary else None,
        related_artifacts_json=dump_json_list(related),
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _community_post_response(db, post=post, current_user=current_user, comment_counts={post.id: 0})


@router.put("/posts/{post_id}", response_model=CommunityPostDetailResponse)
def update_community_post(
    post_id: int,
    payload: CommunityPostUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CommunityPostDetailResponse:
    post = _post_or_404(db, post_id)
    if not can_edit_post(post, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot edit this post.")

    try:
        normalized_category = normalize_category(payload.category)
        primary, related = _normalize_payload_links(
            db,
            payload=payload,
            requester_user_id=current_user.id,
        )
    except (CommunityValidationError, CommunityNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    post.title = payload.title.strip()
    post.slug = ensure_unique_slug(db, title=post.title, exclude_post_id=post.id)
    post.summary = payload.summary.strip()
    post.content_markdown = payload.content_markdown.strip()
    post.category = normalized_category
    post.tags_json = dump_json_list(normalize_tags(payload.tags))
    post.primary_artifact_type = primary.artifact_type if primary else None
    post.primary_artifact_ref = primary.artifact_ref if primary else None
    post.related_artifacts_json = dump_json_list(related)

    if post.status == "published" and not published_linkage_is_public(db, settings=settings, post=post):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Published posts can only link public theorems or public projects.",
        )

    db.commit()
    db.refresh(post)
    return _community_post_response(
        db,
        post=post,
        current_user=current_user,
        comment_counts=comment_count_lookup(db, [post.id]),
    )


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_community_post(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    post = _post_or_404(db, post_id)
    if not can_edit_post(post, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this post.")
    db.query(CommunityPostComment).filter(CommunityPostComment.post_id == post.id).delete()
    db.delete(post)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/posts/{post_id}/publish", response_model=CommunityPostDetailResponse)
def publish_community_post(
    post_id: int,
    payload: CommunityPublishRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CommunityPostDetailResponse:
    post = _post_or_404(db, post_id)
    if not can_edit_post(post, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot publish this post.")

    if payload.published:
        if not published_linkage_is_public(db, settings=settings, post=post):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Published posts can only link public theorems or public projects.",
            )
        post.status = "published"
        post.published_at = now_utc()
    else:
        post.status = "draft"
        post.published_at = None
        post.is_featured = False

    db.commit()
    db.refresh(post)
    return _community_post_response(
        db,
        post=post,
        current_user=current_user,
        comment_counts=comment_count_lookup(db, [post.id]),
    )


@router.post("/posts/{post_id}/feature", response_model=CommunityPostDetailResponse)
def feature_community_post(
    post_id: int,
    payload: CommunityFeatureRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> CommunityPostDetailResponse:
    post = _post_or_404(db, post_id)
    if payload.is_featured and post.status != "published":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only published posts can be featured.",
        )
    post.is_featured = payload.is_featured
    db.commit()
    db.refresh(post)
    return _community_post_response(
        db,
        post=post,
        current_user=current_user,
        comment_counts=comment_count_lookup(db, [post.id]),
    )


@router.get("/posts/{post_id}/comments", response_model=list[CommunityPostCommentResponse])
def list_community_post_comments(
    post_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> list[CommunityPostCommentResponse]:
    post = _post_or_404(db, post_id)
    _ensure_viewable(post, current_user)
    comments = (
        db.query(CommunityPostComment)
        .filter(CommunityPostComment.post_id == post.id)
        .order_by(CommunityPostComment.created_at.asc(), CommunityPostComment.id.asc())
        .all()
    )
    return _serialize_comment_rows(db, comments, current_user=current_user)


@router.post("/posts/{post_id}/comments", response_model=list[CommunityPostCommentResponse])
def create_community_post_comment(
    post_id: int,
    payload: CommunityPostCommentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CommunityPostCommentResponse]:
    post = _post_or_404(db, post_id)
    _ensure_viewable(post, current_user)

    if payload.parent_id is not None:
        parent_comment = (
            db.query(CommunityPostComment)
            .filter(
                CommunityPostComment.id == payload.parent_id,
                CommunityPostComment.post_id == post.id,
            )
            .first()
        )
        if parent_comment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent comment not found.")

    comment = CommunityPostComment(
        post_id=post.id,
        author_id=current_user.id,
        parent_id=payload.parent_id,
        body=payload.body.strip(),
    )
    db.add(comment)
    db.commit()

    comments = (
        db.query(CommunityPostComment)
        .filter(CommunityPostComment.post_id == post.id)
        .order_by(CommunityPostComment.created_at.asc(), CommunityPostComment.id.asc())
        .all()
    )
    return _serialize_comment_rows(db, comments, current_user=current_user)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_community_post_comment(
    comment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    comment = _comment_or_404(db, comment_id)
    if not (current_user.is_admin or current_user.id == comment.author_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this comment.")

    child_ids = (
        db.query(CommunityPostComment.id)
        .filter(CommunityPostComment.parent_id == comment.id)
        .all()
    )
    if child_ids:
        db.query(CommunityPostComment).filter(
            CommunityPostComment.parent_id == comment.id
        ).update({CommunityPostComment.parent_id: None})
    db.delete(comment)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
