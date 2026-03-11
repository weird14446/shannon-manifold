from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.user import User
from security import get_current_user
from services.chat_provider import ChatProviderError, generate_chat_reply
from services.rag_index import retrieve_rag_context

router = APIRouter(prefix="/chat", tags=["chat"])
settings = get_settings()

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCodeContext(BaseModel):
    title: str
    content: str
    language: str | None = None
    module_name: str | None = None
    path: str | None = None


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    code_context: ChatCodeContext | None = None

@router.post("/")
async def chat_interaction(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not request.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message must not be empty.",
        )

    try:
        rag_context = await retrieve_rag_context(
            db,
            settings=settings,
            owner_id=current_user.id,
            query=request.message,
            limit=5,
        )
        return await generate_chat_reply(
            message=request.message,
            history=request.history,
            user_full_name=current_user.full_name,
            settings=settings,
            rag_context=rag_context,
            code_context=request.code_context.model_dump() if request.code_context else None,
        )
    except ChatProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
