from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from uuid import uuid4

from database import SessionLocal
from models.proof_workspace import ProofWorkspace
from services.lean_workspace import LeanWorkspaceError, build_workspace_module
from services.project_workspace import validate_project_context_copy
from services.rag_index import sync_playground_document_to_rag, sync_proof_workspace_to_rag


COMPLETED_JOB_TTL = timedelta(hours=1)
MAX_TRACKED_JOBS = 256


@dataclass(slots=True)
class VerifiedBuildJobRecord:
    job_id: str
    owner_id: int
    saved_path: str
    saved_module: str
    title: str
    code: str
    proof_workspace_id: int | None
    pdf_filename: str | None
    project_root: str | None
    project_file_path: str | None
    validation_project_root: str | None
    validation_project_file_path: str | None
    remix_provenance: dict[str, Any] | None
    final_workspace_status: str | None
    status: str = "queued"
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, object]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "error": self.error,
            "saved_path": self.saved_path,
            "saved_module": self.saved_module,
            "proof_workspace_id": self.proof_workspace_id,
            "pdf_filename": self.pdf_filename,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


_jobs: dict[str, VerifiedBuildJobRecord] = {}
_tasks: dict[str, asyncio.Task[None]] = {}
_jobs_lock = Lock()


def _touch(record: VerifiedBuildJobRecord, *, status: str | None = None, error: str | None = None) -> None:
    if status is not None:
        record.status = status
    record.error = error
    record.updated_at = datetime.now(timezone.utc)


def _prune_jobs_locked() -> None:
    now = datetime.now(timezone.utc)
    completed_job_ids = [
        job_id
        for job_id, record in _jobs.items()
        if record.status in {"succeeded", "failed"}
        and now - record.updated_at > COMPLETED_JOB_TTL
        and job_id not in _tasks
    ]
    for job_id in completed_job_ids:
        _jobs.pop(job_id, None)

    if len(_jobs) <= MAX_TRACKED_JOBS:
        return

    removable = sorted(
        (
            (record.updated_at, job_id)
            for job_id, record in _jobs.items()
            if record.status in {"succeeded", "failed"} and job_id not in _tasks
        ),
        key=lambda item: item[0],
    )
    for _, job_id in removable:
        if len(_jobs) <= MAX_TRACKED_JOBS:
            break
        _jobs.pop(job_id, None)


def get_verified_build_job(job_id: str, *, owner_id: int) -> dict[str, object] | None:
    with _jobs_lock:
        _prune_jobs_locked()
        record = _jobs.get(job_id)
        if record is None or record.owner_id != owner_id:
            return None
        return record.to_dict()


async def _validate_saved_target(
    *,
    settings,
    saved_path: str,
    saved_module: str,
    code: str,
    validation_project_root: str | None,
    validation_project_file_path: str | None,
) -> None:
    try:
        await build_workspace_module(
            settings,
            relative_workspace_path=saved_path,
            module_name=saved_module,
        )
        return
    except LeanWorkspaceError as exc:
        if validation_project_root and validation_project_file_path:
            try:
                await validate_project_context_copy(
                    settings,
                    project_root=validation_project_root,
                    source_relative_path=validation_project_file_path,
                    content=code,
                )
                return
            except LeanWorkspaceError as project_exc:
                raise RuntimeError(str(project_exc)) from project_exc
        raise RuntimeError(str(exc)) from exc


async def _run_verified_build_job(job_id: str, *, settings) -> None:
    with _jobs_lock:
        record = _jobs.get(job_id)
        if record is None:
            return
        _touch(record, status="running", error=None)
        payload = VerifiedBuildJobRecord(
            job_id=record.job_id,
            owner_id=record.owner_id,
            saved_path=record.saved_path,
            saved_module=record.saved_module,
            title=record.title,
            code=record.code,
            proof_workspace_id=record.proof_workspace_id,
            pdf_filename=record.pdf_filename,
            project_root=record.project_root,
            project_file_path=record.project_file_path,
            validation_project_root=record.validation_project_root,
            validation_project_file_path=record.validation_project_file_path,
            remix_provenance=record.remix_provenance,
            final_workspace_status=record.final_workspace_status,
            status=record.status,
            error=record.error,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    db = SessionLocal()
    workspace: ProofWorkspace | None = None
    try:
        if payload.proof_workspace_id is not None:
            workspace = (
                db.query(ProofWorkspace)
                .filter(
                    ProofWorkspace.id == payload.proof_workspace_id,
                    ProofWorkspace.owner_id == payload.owner_id,
                )
                .first()
            )
            if workspace is None:
                raise RuntimeError("Proof workspace not found for the queued build job.")

        await _validate_saved_target(
            settings=settings,
            saved_path=payload.saved_path,
            saved_module=payload.saved_module,
            code=payload.code,
            validation_project_root=payload.validation_project_root,
            validation_project_file_path=payload.validation_project_file_path,
        )

        if workspace is not None:
            workspace.status = payload.final_workspace_status or workspace.status or "edited"
            await sync_proof_workspace_to_rag(
                db,
                settings=settings,
                workspace=workspace,
                saved_path=payload.saved_path,
                saved_module=payload.saved_module,
                project_root=payload.project_root,
                project_file_path=payload.project_file_path,
                validation_project_root=payload.validation_project_root,
                validation_project_file_path=payload.validation_project_file_path,
                remix_provenance=payload.remix_provenance,
            )
        else:
            await sync_playground_document_to_rag(
                db,
                settings=settings,
                owner_id=payload.owner_id,
                title=payload.title,
                saved_path=payload.saved_path,
                saved_module=payload.saved_module,
                content=payload.code,
                project_root=payload.project_root,
                project_file_path=payload.project_file_path,
                validation_project_root=payload.validation_project_root,
                validation_project_file_path=payload.validation_project_file_path,
                remix_provenance=payload.remix_provenance,
            )

        db.commit()
        with _jobs_lock:
            record = _jobs.get(job_id)
            if record is not None:
                _touch(record, status="succeeded", error=None)
    except Exception as exc:
        db.rollback()
        if workspace is not None:
            try:
                workspace.status = "build_failed"
                db.commit()
            except Exception:
                db.rollback()
        with _jobs_lock:
            record = _jobs.get(job_id)
            if record is not None:
                _touch(record, status="failed", error=str(exc))
    finally:
        db.close()


def enqueue_verified_build_job(
    *,
    settings,
    owner_id: int,
    saved_path: str,
    saved_module: str,
    title: str,
    code: str,
    proof_workspace_id: int | None = None,
    pdf_filename: str | None = None,
    project_root: str | None = None,
    project_file_path: str | None = None,
    validation_project_root: str | None = None,
    validation_project_file_path: str | None = None,
    remix_provenance: dict[str, Any] | None = None,
    final_workspace_status: str | None = None,
) -> dict[str, object]:
    record = VerifiedBuildJobRecord(
        job_id=uuid4().hex,
        owner_id=owner_id,
        saved_path=saved_path,
        saved_module=saved_module,
        title=title,
        code=code,
        proof_workspace_id=proof_workspace_id,
        pdf_filename=pdf_filename,
        project_root=project_root,
        project_file_path=project_file_path,
        validation_project_root=validation_project_root,
        validation_project_file_path=validation_project_file_path,
        remix_provenance=remix_provenance,
        final_workspace_status=final_workspace_status,
    )

    with _jobs_lock:
        _jobs[record.job_id] = record
        _prune_jobs_locked()

    task = asyncio.create_task(_run_verified_build_job(record.job_id, settings=settings))
    _tasks[record.job_id] = task

    def _cleanup(_: asyncio.Task[None]) -> None:
        with _jobs_lock:
            _tasks.pop(record.job_id, None)
            _prune_jobs_locked()

    task.add_done_callback(_cleanup)
    return record.to_dict()
