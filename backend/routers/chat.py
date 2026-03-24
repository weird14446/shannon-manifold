import base64
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.user import User
from security import get_current_user
from services.proof_pipeline import extract_text_from_pdf_bytes
from services.chat_provider import (
    ChatProviderConfigurationError,
    ChatProviderError,
    generate_chat_reply,
)
from services.rag_index import retrieve_rag_context

router = APIRouter(prefix="/chat", tags=["chat"])
settings = get_settings()
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
}

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCodeContext(BaseModel):
    title: str
    content: str
    language: str | None = None
    module_name: str | None = None
    path: str | None = None
    imports: list[str] = Field(default_factory=list)
    cursor_line: int | None = None
    cursor_column: int | None = None
    cursor_line_text: str | None = None
    nearby_code: str | None = None
    proof_state: str | None = None
    active_goal: str | None = None
    proof_workspace_id: int | None = None
    attached_pdf_filename: str | None = None


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    code_context: ChatCodeContext | None = None
    attachment_context: dict[str, str | int] | None = None


async def _read_limited_upload(file: UploadFile, *, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"The attached file exceeds the {max_bytes // (1024 * 1024)}MB chat limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _extract_attachment_context(file: UploadFile | None) -> dict[str, str | int] | None:
    if file is None or not file.filename:
        return None

    suffix = Path(file.filename).suffix.lower()
    mime_type = (file.content_type or "").lower()
    file_bytes = await _read_limited_upload(file, max_bytes=settings.chat_attachment_max_bytes)
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The attached file is empty.",
        )

    if suffix == ".pdf" or mime_type == "application/pdf":
        try:
            extracted_text = extract_text_from_pdf_bytes(file_bytes)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to extract text from the attached PDF.",
            ) from exc

        if not extracted_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The attached PDF did not contain extractable text.",
            )

        page_markers = extracted_text.count("[Page ")
        return {
            "kind": "pdf",
            "filename": file.filename,
            "mime_type": "application/pdf",
            "pages": max(page_markers, 1),
            "content": extracted_text,
        }

    if suffix in SUPPORTED_IMAGE_EXTENSIONS or mime_type in SUPPORTED_IMAGE_MIME_TYPES:
        resolved_mime_type = mime_type or {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }.get(suffix, "image/png")
        return {
            "kind": "image",
            "filename": file.filename,
            "mime_type": resolved_mime_type,
            "size_bytes": len(file_bytes),
            "data_base64": base64.b64encode(file_bytes).decode("ascii"),
        }

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Supported chat attachments are PDF, PNG, JPG, JPEG, WEBP, and GIF.",
    )


def _parse_history_json(raw_history: str | None) -> list[ChatMessage]:
    if not raw_history:
        return []

    try:
        parsed = json.loads(raw_history)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chat history JSON is invalid.",
        ) from exc

    try:
        return [ChatMessage.model_validate(item) for item in parsed]
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chat history payload is invalid.",
        ) from exc


def _parse_code_context_json(raw_code_context: str | None) -> ChatCodeContext | None:
    if not raw_code_context:
        return None

    try:
        return ChatCodeContext.model_validate_json(raw_code_context)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code context payload is invalid.",
        ) from exc


async def _parse_chat_request(request: Request) -> ChatRequest:
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        try:
            payload = await request.json()
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Chat request JSON is invalid.",
            ) from exc

        try:
            return ChatRequest.model_validate(payload)
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Chat request payload is invalid.",
            ) from exc

    form = await request.form()
    message = str(form.get("message") or "")
    history = _parse_history_json(form.get("history"))
    code_context = _parse_code_context_json(form.get("code_context"))
    attachment_context = await _extract_attachment_context(
        form.get("attachment_file") or form.get("pdf_file")
    )

    return ChatRequest(
        message=message,
        history=history,
        code_context=code_context,
        attachment_context=attachment_context,
    )


def _build_rag_query(
    message: str,
    code_context: ChatCodeContext | None,
    attachment_context: dict[str, str | int] | None,
) -> str:
    parts = [message.strip()]
    if code_context is None and not attachment_context:
        return "\n".join(part for part in parts if part)

    if attachment_context:
        attachment_kind = str(attachment_context.get("kind") or "")
        attachment_name = str(attachment_context.get("filename") or "attached-file")
        if attachment_kind == "pdf":
            attachment_excerpt = str(attachment_context.get("content") or "").strip()
            if attachment_excerpt:
                parts.append(f"Attached PDF ({attachment_name}):\n{attachment_excerpt[:1800]}")
        elif attachment_kind == "image":
            parts.append(f"Attached image: {attachment_name}")

    if code_context and code_context.active_goal:
        parts.append(f"Active goal:\n{code_context.active_goal[:1000]}")
    elif code_context and code_context.proof_state:
        parts.append(f"Proof state:\n{code_context.proof_state[:1200]}")

    if code_context and code_context.cursor_line_text:
        parts.append(f"Cursor line:\n{code_context.cursor_line_text[:500]}")

    if code_context and code_context.nearby_code:
        parts.append(f"Nearby code:\n{code_context.nearby_code[:1200]}")

    if code_context and code_context.imports:
        parts.append("Imports: " + ", ".join(code_context.imports[:12]))

    return "\n\n".join(part for part in parts if part)

@router.post("/")
async def chat_interaction(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    parsed_request = await _parse_chat_request(request)
    attachment_context = parsed_request.attachment_context

    if not parsed_request.message.strip() and not attachment_context:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message must not be empty unless a file is attached.",
        )

    try:
        rag_context = await retrieve_rag_context(
            db,
            settings=settings,
            owner_id=current_user.id,
            query=_build_rag_query(
                parsed_request.message,
                parsed_request.code_context,
                attachment_context,
            ),
            limit=5,
        )
        return await generate_chat_reply(
            message=parsed_request.message,
            history=parsed_request.history,
            user_full_name=current_user.full_name,
            settings=settings,
            rag_context=rag_context,
            code_context=(
                parsed_request.code_context.model_dump() if parsed_request.code_context else None
            ),
            attachment_context=attachment_context,
        )
    except ChatProviderConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ChatProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
