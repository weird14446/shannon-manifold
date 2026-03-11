from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # noqa: F401
from config import get_settings
from database import Base, SessionLocal, engine
from routers import agents, auth, chat, lean_workspace, proofs, theorems
from seed import seed_database

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.proof_upload_dir.mkdir(parents=True, exist_ok=True)
    settings.proof_artifact_dir.mkdir(parents=True, exist_ok=True)
    settings.lean_workspace_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
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
app.include_router(proofs.router)
app.include_router(theorems.router)
app.include_router(chat.router)
app.include_router(agents.router)
app.include_router(lean_workspace.router)

@app.get("/")
def read_root():
    return {
        "status": "ok",
        "message": "Shannon Manifold API is running.",
        "database": settings.mysql_database,
    }
