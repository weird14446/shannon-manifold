from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # noqa: F401
from config import get_settings
from database import Base, SessionLocal, engine
from routers import admin, auth, chat, discussions, lean_workspace, proofs, projects, theorems
from services.admin_bootstrap import bootstrap_admin_user, ensure_user_auth_columns
from services.project_workspace import backfill_existing_project_scaffolds
from services.rag_index import (
    cleanup_project_documents,
    cleanup_duplicate_verified_documents,
    cleanup_missing_workspace_documents,
    ensure_rag_collection,
    sync_existing_proof_documents,
    sync_workspace_seed_documents,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.proof_upload_dir.mkdir(parents=True, exist_ok=True)
    settings.proof_artifact_dir.mkdir(parents=True, exist_ok=True)
    settings.lean_workspace_dir.mkdir(parents=True, exist_ok=True)
    (settings.lean_workspace_dir / "projects").mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    ensure_user_auth_columns(engine)
    repaired_projects = backfill_existing_project_scaffolds(settings)
    if repaired_projects:
        print(f"Backfilled Lean project scaffolds: {repaired_projects}")
    try:
        ensure_rag_collection(settings)
    except Exception as exc:  # pragma: no cover - startup resilience
        print(f"Warning: failed to initialize Qdrant collection: {exc}")
    db = SessionLocal()
    try:
        bootstrap_admin_user(db, settings)
        try:
            await sync_workspace_seed_documents(db, settings)
            cleanup_missing_workspace_documents(db, settings=settings)
            await sync_existing_proof_documents(db, settings)
            cleanup_project_documents(db, settings=settings)
            cleanup_duplicate_verified_documents(db, settings=settings)
            db.commit()
        except Exception as exc:  # pragma: no cover - startup resilience
            db.rollback()
            print(f"Warning: failed to sync workspace seed documents: {exc}")
    finally:
        db.close()
    yield


app = FastAPI(title="Shannon Manifold API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(proofs.router)
app.include_router(theorems.router)
app.include_router(discussions.router)
app.include_router(chat.router)
app.include_router(lean_workspace.router)
app.include_router(projects.router)

@app.get("/")
def read_root():
    return {
        "status": "ok",
        "message": "Shannon Manifold API is running.",
        "database": settings.mysql_database,
    }
