from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import theorems, chat, agents

app = FastAPI(title="Shannon Manifold API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(theorems.router)
app.include_router(chat.router)
app.include_router(agents.router)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Shannon Manifold API is running."}
