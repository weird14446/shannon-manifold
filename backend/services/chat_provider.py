from __future__ import annotations

import asyncio
from typing import Any

import httpx

from config import Settings


class ChatProviderError(RuntimeError):
    pass


def _normalize_history(history: list[Any], max_items: int) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []

    for message in history[-max_items:]:
        role = getattr(message, "role", None)
        content = getattr(message, "content", None)

        if role not in {"user", "assistant"}:
            continue

        if not isinstance(content, str):
            continue

        stripped = content.strip()
        if not stripped:
            continue

        normalized.append({"role": role, "content": stripped})

    return normalized


def build_mock_chat_reply(
    *,
    message: str,
    history: list[Any],
    user_full_name: str,
    settings: Settings,
) -> dict[str, str]:
    del history
    user_msg = message.lower()

    response_content = (
        f"I am the theorem oracle (Model: {settings.chatbot_model}) "
        f"supporting {user_full_name}. "
    )
    if "pythagoras" in user_msg or "pythagorean" in user_msg:
        response_content += (
            "According to the verified theorem database (Theorem ID 1 in Lean4), the sum "
            "of the squares of the lengths of the legs of a right triangle is equal to the "
            "square of the length of the hypotenuse."
        )
    elif "fermat" in user_msg:
        response_content += (
            "Fermat's Last theorem for n=3 is verified in Rocq (Theorem ID 2)."
        )
    else:
        response_content += (
            "I can assist you with verified proofs, Lean4, Rocq, and formalization workflows. "
            "How can I help you today?"
        )

    return {
        "reply": response_content,
        "provider": "mock",
        "model": settings.chatbot_model,
    }


async def generate_chat_reply(
    *,
    message: str,
    history: list[Any],
    user_full_name: str,
    settings: Settings,
) -> dict[str, str]:
    provider = settings.chatbot_provider

    if provider != "openai_compatible":
        await asyncio.sleep(0.35)
        return build_mock_chat_reply(
            message=message,
            history=history,
            user_full_name=user_full_name,
            settings=settings,
        )

    if not settings.chatbot_api_key:
        raise ChatProviderError(
            "CHATBOT_PROVIDER is set to openai_compatible but CHATBOT_API_KEY is missing."
        )

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                f"{settings.chatbot_system_prompt}\n"
                f"Current member: {user_full_name}.\n"
                "Respond in Markdown when useful."
            ),
        },
        *_normalize_history(history, settings.chatbot_max_history_messages),
        {"role": "user", "content": message.strip()},
    ]

    payload = {
        "model": settings.chatbot_model,
        "messages": messages,
        "temperature": settings.chatbot_temperature,
    }

    headers = {
        "Authorization": f"Bearer {settings.chatbot_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=settings.chatbot_timeout_seconds) as client:
        try:
            response = await client.post(
                f"{settings.chatbot_api_base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.strip() or str(exc)
            raise ChatProviderError(f"Chat provider rejected the request: {detail}") from exc
        except httpx.HTTPError as exc:
            raise ChatProviderError(f"Chat provider request failed: {exc}") from exc

    data = response.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ChatProviderError("Chat provider returned an unexpected response shape.") from exc

    if isinstance(content, list):
        text_parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(item.get("text", ""))
        content = "".join(text_parts)

    if not isinstance(content, str) or not content.strip():
        raise ChatProviderError("Chat provider returned an empty reply.")

    return {
        "reply": content.strip(),
        "provider": provider,
        "model": settings.chatbot_model,
    }
