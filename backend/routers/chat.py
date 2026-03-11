from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from config import get_settings
from models.user import User
from security import get_current_user
from services.chat_provider import ChatProviderError, generate_chat_reply

router = APIRouter(prefix="/chat", tags=["chat"])
settings = get_settings()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)

@router.post("/")
async def chat_interaction(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    if not request.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message must not be empty.",
        )

    try:
        return await generate_chat_reply(
            message=request.message,
            history=request.history,
            user_full_name=current_user.full_name,
            settings=settings,
        )
    except ChatProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
