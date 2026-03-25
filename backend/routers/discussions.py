from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.discussion_comment import DiscussionComment
from models.discussion_thread import DiscussionThread
from models.user import User
from security import get_current_user, get_current_user_optional
from services.discussions import (
    DISCUSSION_ANCHOR_TYPES,
    DISCUSSION_STATUSES,
    DiscussionNotFoundError,
    DiscussionScopeContext,
    DiscussionValidationError,
    anchor_is_outdated,
    anchor_key_for_payload,
    build_anchor_label,
    canonical_scope_key,
    normalize_anchor,
    parse_anchor_json,
    resolve_scope_context,
)

router = APIRouter(prefix="/discussions", tags=["discussions"])
settings = get_settings()


class DiscussionThreadCreateRequest(BaseModel):
    scope_type: str = Field(min_length=1, max_length=32)
    scope_key: str = Field(min_length=1, max_length=512)
    anchor_type: str = Field(min_length=1, max_length=32)
    anchor_json: dict[str, Any] = Field(default_factory=dict)
    body: str = Field(min_length=1, max_length=20_000)


class DiscussionCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_id: int | None = None


class DiscussionThreadUpdateRequest(BaseModel):
    status: str = Field(min_length=1, max_length=16)


class DiscussionCommentResponse(BaseModel):
    id: int
    thread_id: int
    author_id: int
    author_name: str
    parent_id: int | None = None
    parent_author_name: str | None = None
    body: str
    created_at: str
    updated_at: str
    can_delete: bool


class DiscussionThreadSummaryResponse(BaseModel):
    id: int
    scope_type: str
    scope_key: str
    anchor_type: str
    anchor_key: str
    anchor_json: dict[str, Any]
    anchor_label: str
    status: str
    is_outdated: bool
    created_by: int
    created_by_name: str
    created_at: str
    updated_at: str
    latest_activity_at: str
    comment_count: int
    latest_comment_preview: str | None = None
    can_resolve: bool


class DiscussionThreadDetailResponse(DiscussionThreadSummaryResponse):
    comments: list[DiscussionCommentResponse]


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _thread_or_404(db: Session, thread_id: int) -> DiscussionThread:
    thread = db.query(DiscussionThread).filter(DiscussionThread.id == thread_id).first()
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discussion thread not found.")
    return thread


def _comment_or_404(db: Session, comment_id: int) -> DiscussionComment:
    comment = db.query(DiscussionComment).filter(DiscussionComment.id == comment_id).first()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discussion comment not found.")
    return comment


def _scope_context_or_404(
    db: Session,
    *,
    scope_type: str,
    scope_key: str,
    current_user: User | None,
) -> DiscussionScopeContext:
    try:
        normalized_scope_key = canonical_scope_key(scope_type, scope_key)
        return resolve_scope_context(
            db,
            settings=settings,
            scope_type=scope_type,
            scope_key=normalized_scope_key,
            current_user=current_user,
        )
    except DiscussionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DiscussionValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


def _normalize_anchor_or_422(
    scope: DiscussionScopeContext,
    *,
    anchor_type: str,
    anchor_json: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    try:
        normalized_anchor_type = anchor_type.strip().lower()
        normalized_anchor = normalize_anchor(
            scope,
            anchor_type=normalized_anchor_type,
            anchor_json=anchor_json,
        )
        return normalized_anchor_type, normalized_anchor
    except DiscussionValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except DiscussionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


def _build_user_lookup(db: Session, user_ids: set[int]) -> dict[int, User]:
    if not user_ids:
        return {}
    users = db.query(User).filter(User.id.in_(sorted(user_ids))).all()
    return {user.id: user for user in users}


def _serialize_comment(
    comment: DiscussionComment,
    *,
    user_lookup: dict[int, User],
    parent_lookup: dict[int, DiscussionComment],
    current_user: User | None,
) -> DiscussionCommentResponse:
    author = user_lookup.get(comment.author_id)
    parent = parent_lookup.get(comment.parent_id) if comment.parent_id is not None else None
    parent_author = user_lookup.get(parent.author_id) if parent is not None else None
    return DiscussionCommentResponse(
        id=comment.id,
        thread_id=comment.thread_id,
        author_id=comment.author_id,
        author_name=author.full_name if author is not None else f"User {comment.author_id}",
        parent_id=comment.parent_id,
        parent_author_name=parent_author.full_name if parent_author is not None else None,
        body=comment.body,
        created_at=comment.created_at.isoformat(),
        updated_at=comment.updated_at.isoformat(),
        can_delete=bool(current_user and (current_user.is_admin or current_user.id == comment.author_id)),
    )


def _build_thread_summary(
    thread: DiscussionThread,
    *,
    scope: DiscussionScopeContext,
    user_lookup: dict[int, User],
    comment_rows: list[DiscussionComment],
) -> DiscussionThreadSummaryResponse:
    anchor_json = parse_anchor_json(thread.anchor_json)
    created_by = user_lookup.get(thread.created_by)
    latest_comment = comment_rows[-1] if comment_rows else None
    latest_activity = latest_comment.updated_at if latest_comment is not None else thread.updated_at
    latest_comment_preview = None
    if latest_comment is not None:
        compact = " ".join(latest_comment.body.split())
        latest_comment_preview = compact[:180] or None

    return DiscussionThreadSummaryResponse(
        id=thread.id,
        scope_type=thread.scope_type,
        scope_key=thread.scope_key,
        anchor_type=thread.anchor_type,
        anchor_key=anchor_key_for_payload(thread.anchor_type, anchor_json),
        anchor_json=anchor_json,
        anchor_label=build_anchor_label(thread.anchor_type, anchor_json),
        status=thread.status,
        is_outdated=anchor_is_outdated(scope, thread.anchor_type, anchor_json),
        created_by=thread.created_by,
        created_by_name=created_by.full_name if created_by is not None else f"User {thread.created_by}",
        created_at=thread.created_at.isoformat(),
        updated_at=thread.updated_at.isoformat(),
        latest_activity_at=latest_activity.isoformat(),
        comment_count=len(comment_rows),
        latest_comment_preview=latest_comment_preview,
        can_resolve=scope.can_resolve,
    )


def _build_thread_detail(
    db: Session,
    *,
    thread: DiscussionThread,
    scope: DiscussionScopeContext,
    current_user: User | None,
) -> DiscussionThreadDetailResponse:
    comments = (
        db.query(DiscussionComment)
        .filter(DiscussionComment.thread_id == thread.id)
        .order_by(DiscussionComment.created_at.asc(), DiscussionComment.id.asc())
        .all()
    )
    user_lookup = _build_user_lookup(
        db,
        {thread.created_by, *(comment.author_id for comment in comments)},
    )
    parent_lookup = {comment.id: comment for comment in comments}
    summary = _build_thread_summary(
        thread,
        scope=scope,
        user_lookup=user_lookup,
        comment_rows=comments,
    )
    return DiscussionThreadDetailResponse(
        **summary.model_dump(),
        comments=[
            _serialize_comment(
                comment,
                user_lookup=user_lookup,
                parent_lookup=parent_lookup,
                current_user=current_user,
            )
            for comment in comments
        ],
    )


@router.get("/", response_model=list[DiscussionThreadSummaryResponse])
def list_discussion_threads(
    scope_type: str = Query(min_length=1, max_length=32),
    scope_key: str = Query(min_length=1, max_length=512),
    anchor_type: str | None = Query(default=None, min_length=1, max_length=32),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[DiscussionThreadSummaryResponse]:
    scope = _scope_context_or_404(
        db,
        scope_type=scope_type.strip().lower(),
        scope_key=scope_key,
        current_user=current_user,
    )
    query = (
        db.query(DiscussionThread)
        .filter(
            DiscussionThread.scope_type == scope.scope_type,
            DiscussionThread.scope_key == scope.scope_key,
        )
        .order_by(DiscussionThread.updated_at.desc(), DiscussionThread.id.desc())
    )
    normalized_anchor_type = anchor_type.strip().lower() if anchor_type else None
    if normalized_anchor_type:
        if normalized_anchor_type not in DISCUSSION_ANCHOR_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unsupported discussion anchor type.",
            )
        query = query.filter(DiscussionThread.anchor_type == normalized_anchor_type)

    threads = query.all()
    if not threads:
        return []

    comments = (
        db.query(DiscussionComment)
        .filter(DiscussionComment.thread_id.in_([thread.id for thread in threads]))
        .order_by(DiscussionComment.created_at.asc(), DiscussionComment.id.asc())
        .all()
    )
    comments_by_thread: dict[int, list[DiscussionComment]] = {}
    user_ids = {thread.created_by for thread in threads}
    for comment in comments:
        comments_by_thread.setdefault(comment.thread_id, []).append(comment)
        user_ids.add(comment.author_id)
    user_lookup = _build_user_lookup(db, user_ids)

    return [
        _build_thread_summary(
            thread,
            scope=scope,
            user_lookup=user_lookup,
            comment_rows=comments_by_thread.get(thread.id, []),
        )
        for thread in threads
    ]


@router.post("/threads", response_model=DiscussionThreadDetailResponse, status_code=status.HTTP_201_CREATED)
def create_discussion_thread(
    payload: DiscussionThreadCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DiscussionThreadDetailResponse:
    scope = _scope_context_or_404(
        db,
        scope_type=payload.scope_type.strip().lower(),
        scope_key=payload.scope_key,
        current_user=current_user,
    )
    anchor_type, anchor_json = _normalize_anchor_or_422(
        scope,
        anchor_type=payload.anchor_type,
        anchor_json=payload.anchor_json,
    )
    now = _now_utc()
    thread = DiscussionThread(
        scope_type=scope.scope_type,
        scope_key=scope.scope_key,
        anchor_type=anchor_type,
        anchor_json=json.dumps(anchor_json, ensure_ascii=True, sort_keys=True),
        status="open",
        created_by=current_user.id,
        updated_at=now,
    )
    db.add(thread)
    db.flush()
    comment = DiscussionComment(
        thread_id=thread.id,
        author_id=current_user.id,
        body=payload.body.strip(),
    )
    db.add(comment)
    db.commit()
    db.refresh(thread)
    return _build_thread_detail(db, thread=thread, scope=scope, current_user=current_user)


@router.get("/threads/{thread_id}", response_model=DiscussionThreadDetailResponse)
def get_discussion_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> DiscussionThreadDetailResponse:
    thread = _thread_or_404(db, thread_id)
    scope = _scope_context_or_404(
        db,
        scope_type=thread.scope_type,
        scope_key=thread.scope_key,
        current_user=current_user,
    )
    return _build_thread_detail(db, thread=thread, scope=scope, current_user=current_user)


@router.post("/threads/{thread_id}/comments", response_model=DiscussionThreadDetailResponse)
def create_discussion_comment(
    thread_id: int,
    payload: DiscussionCommentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DiscussionThreadDetailResponse:
    thread = _thread_or_404(db, thread_id)
    scope = _scope_context_or_404(
        db,
        scope_type=thread.scope_type,
        scope_key=thread.scope_key,
        current_user=current_user,
    )

    parent_comment = None
    if payload.parent_id is not None:
        parent_comment = _comment_or_404(db, payload.parent_id)
        if parent_comment.thread_id != thread.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Reply target must belong to the same discussion thread.",
            )

    comment = DiscussionComment(
        thread_id=thread.id,
        author_id=current_user.id,
        parent_id=parent_comment.id if parent_comment is not None else None,
        body=payload.body.strip(),
    )
    db.add(comment)
    thread.updated_at = _now_utc()
    db.commit()
    db.refresh(thread)
    return _build_thread_detail(db, thread=thread, scope=scope, current_user=current_user)


@router.patch("/threads/{thread_id}", response_model=DiscussionThreadDetailResponse)
def update_discussion_thread(
    thread_id: int,
    payload: DiscussionThreadUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DiscussionThreadDetailResponse:
    thread = _thread_or_404(db, thread_id)
    scope = _scope_context_or_404(
        db,
        scope_type=thread.scope_type,
        scope_key=thread.scope_key,
        current_user=current_user,
    )
    if not scope.can_resolve:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to update this discussion thread.",
        )

    next_status = payload.status.strip().lower()
    if next_status not in DISCUSSION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Discussion thread status must be either open or resolved.",
        )

    thread.status = next_status
    thread.updated_at = _now_utc()
    db.commit()
    db.refresh(thread)
    return _build_thread_detail(db, thread=thread, scope=scope, current_user=current_user)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_discussion_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    comment = _comment_or_404(db, comment_id)
    thread = _thread_or_404(db, comment.thread_id)
    _scope_context_or_404(
        db,
        scope_type=thread.scope_type,
        scope_key=thread.scope_key,
        current_user=current_user,
    )

    if not (current_user.is_admin or current_user.id == comment.author_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this comment.",
        )

    has_replies = (
        db.query(DiscussionComment)
        .filter(DiscussionComment.parent_id == comment.id)
        .first()
        is not None
    )
    if has_replies:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Comments with replies cannot be deleted in this version.",
        )

    db.delete(comment)
    db.flush()
    remaining_comments = (
        db.query(DiscussionComment)
        .filter(DiscussionComment.thread_id == thread.id)
        .order_by(DiscussionComment.updated_at.desc(), DiscussionComment.id.desc())
        .all()
    )
    if not remaining_comments:
        db.delete(thread)
    else:
        thread.updated_at = remaining_comments[0].updated_at
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
