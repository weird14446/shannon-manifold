from __future__ import annotations

import asyncio
import re
from typing import Any

import httpx

from config import Settings


class ChatProviderError(RuntimeError):
    pass


class ChatProviderConfigurationError(ChatProviderError):
    pass


CODE_BLOCK_RE = re.compile(r"```(?P<lang>[A-Za-z0-9_+-]*)\n(?P<code>.*?)```", re.DOTALL)


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

        if role == "assistant" and not normalized:
            continue

        if normalized and normalized[-1]["role"] == role:
            normalized[-1]["content"] = stripped
            continue

        normalized.append({"role": role, "content": stripped})

    return normalized


def _build_system_prompt(
    *,
    settings: Settings,
    user_full_name: str,
    rag_context: list[dict[str, Any]] | None,
    code_context: dict[str, Any] | None,
    attachment_context: dict[str, Any] | None,
) -> str:
    context_sections: list[str] = []
    for item in rag_context or []:
        context_sections.append(
            (
                f"Title: {item.get('title')}\n"
                f"Module: {item.get('module_name')}\n"
                f"Path: {item.get('path')}\n"
                f"Symbol: {item.get('symbol_name')}\n"
                f"Lines: {item.get('start_line')}-{item.get('end_line')}\n"
                f"Summary: {item.get('summary')}\n"
                f"Content:\n{item.get('content')}"
            ).strip()
        )

    prompt = (
        f"{settings.chatbot_system_prompt}\n"
        f"Current member: {user_full_name}.\n"
        "Use the retrieved proof and Lean context when it is relevant.\n"
        "If the retrieved context is insufficient, say so explicitly.\n"
        "If an active Lean proof state is available, treat it as the primary source of truth.\n"
        "Base tactic suggestions and lemma recommendations on the exact goal, local context, imports, and cursor location.\n"
        "If the goal is already solved, say that clearly instead of suggesting more tactics.\n"
        "When helping write code, explain briefly and then provide a fenced code block.\n"
        "If revising an existing Lean file, prefer returning the full updated Lean file in a ```lean block.\n"
        "Respond in Markdown when useful."
    )

    if context_sections:
        prompt += "\n\nRetrieved context:\n\n" + "\n\n---\n\n".join(context_sections)

    if code_context:
        code_title = str(code_context.get("title") or "Untitled document")
        code_language = str(code_context.get("language") or "Lean4")
        code_module = str(code_context.get("module_name") or "").strip()
        code_path = str(code_context.get("path") or "").strip()
        code_body = str(code_context.get("content") or "").strip()
        code_imports = code_context.get("imports") or []
        cursor_line = code_context.get("cursor_line")
        cursor_column = code_context.get("cursor_column")
        cursor_line_text = str(code_context.get("cursor_line_text") or "").strip()
        nearby_code = str(code_context.get("nearby_code") or "").strip()
        proof_state = str(code_context.get("proof_state") or "").strip()
        active_goal = str(code_context.get("active_goal") or "").strip()
        if len(code_body) > 8000:
            code_body = code_body[:8000].rstrip() + "\n\n-- Truncated for prompt length --"
        if len(nearby_code) > 2500:
            nearby_code = nearby_code[:2500].rstrip() + "\n\n-- Truncated nearby code --"
        if len(proof_state) > 3000:
            proof_state = proof_state[:3000].rstrip() + "\n\n-- Truncated proof state --"
        if len(active_goal) > 1500:
            active_goal = active_goal[:1500].rstrip() + "\n\n-- Truncated active goal --"

        prompt += (
            "\n\nActive editor context:\n"
            f"Title: {code_title}\n"
            f"Language: {code_language}\n"
            f"Module: {code_module or 'n/a'}\n"
            f"Path: {code_path or 'n/a'}\n"
            f"Imports: {', '.join(code_imports) if code_imports else 'n/a'}\n"
            f"Cursor: line {cursor_line or 'n/a'}, column {cursor_column or 'n/a'}\n"
            f"Cursor line text: {cursor_line_text or 'n/a'}\n"
            "Nearby code:\n"
            f"{nearby_code or '(unavailable)'}\n"
            "Active goal at cursor:\n"
            f"{active_goal or '(no focused goal reported)'}\n"
            "Infoview proof state:\n"
            f"{proof_state or '(no proof state reported)'}\n"
            "Current content:\n"
            f"{code_body or '(empty file)'}"
        )

    if attachment_context:
        attachment_kind = str(attachment_context.get("kind") or "")
        attachment_name = str(attachment_context.get("filename") or "attached-file")
        if attachment_kind == "pdf":
            attachment_pages = attachment_context.get("pages")
            attachment_body = str(attachment_context.get("content") or "").strip()
            if len(attachment_body) > 10000:
                attachment_body = (
                    attachment_body[:10000].rstrip() + "\n\n-- Truncated attached PDF text --"
                )

            prompt += (
                "\n\nAttached PDF context:\n"
                f"Filename: {attachment_name}\n"
                f"Pages with extracted text: {attachment_pages or 'n/a'}\n"
                "Extracted text:\n"
                f"{attachment_body or '(no extractable text)'}"
            )
        elif attachment_kind == "image":
            prompt += (
                "\n\nAttached image context:\n"
                f"Filename: {attachment_name}\n"
                f"MIME type: {attachment_context.get('mime_type') or 'unknown'}\n"
                "Inspect the attached image directly and use it as primary evidence when relevant."
            )

    return prompt


def _extract_suggested_code(reply: str) -> tuple[str | None, str | None]:
    match = CODE_BLOCK_RE.search(reply)
    if not match:
        return None, None

    code = match.group("code").strip()
    if not code:
        return None, None

    language = (match.group("lang") or "").strip() or None
    return code, language


def _extract_openai_compatible_text(data: dict[str, Any]) -> str:
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

    return content.strip()


def _extract_gemini_text(data: dict[str, Any]) -> str:
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        prompt_feedback = data.get("promptFeedback") or data.get("prompt_feedback")
        if isinstance(prompt_feedback, dict):
            block_reason = prompt_feedback.get("blockReason") or prompt_feedback.get("block_reason")
            if block_reason:
                raise ChatProviderError(f"Gemini blocked the request: {block_reason}")
        raise ChatProviderError("Gemini returned no candidate response.")

    first_candidate = candidates[0]
    content = first_candidate.get("content", {})
    parts = content.get("parts", [])
    text_parts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            text_parts.append(text)

    reply = "\n".join(text_parts).strip()
    if reply:
        return reply

    finish_reason = first_candidate.get("finishReason") or first_candidate.get("finish_reason")
    if finish_reason:
        raise ChatProviderError(f"Gemini returned no text. Finish reason: {finish_reason}")
    raise ChatProviderError("Gemini returned an empty reply.")


def _configuration_error_message(provider: str, reason: str) -> str:
    if provider == "gemini":
        return f"Chat provider is misconfigured: {reason} Gemini API key."
    if provider == "openai_compatible":
        return f"Chat provider is misconfigured: {reason} provider API key."
    return f"Chat provider is misconfigured: {reason} API key."


def _looks_like_invalid_gemini_key(detail: str) -> bool:
    lowered = detail.lower()
    return (
        "api_key_invalid" in lowered
        or "api key not valid" in lowered
        or "invalid api key" in lowered
        or "request is missing required authentication credential" in lowered
    )


def _looks_like_invalid_openai_key(detail: str) -> bool:
    lowered = detail.lower()
    return (
        "incorrect api key" in lowered
        or "invalid api key" in lowered
        or "invalid authentication" in lowered
        or "unauthorized" in lowered
        or "authentication" in lowered and "failed" in lowered
    )


def _is_placeholder_api_key(api_key: str) -> bool:
    lowered = api_key.strip().lower()
    return lowered.startswith("your-") or "placeholder" in lowered


def build_mock_chat_reply(
    *,
    message: str,
    history: list[Any],
    user_full_name: str,
    settings: Settings,
    rag_context: list[dict[str, Any]] | None = None,
    code_context: dict[str, Any] | None = None,
    attachment_context: dict[str, Any] | None = None,
) -> dict[str, str]:
    del history
    user_msg = message.lower()

    response_content = (
        f"I am the theorem oracle (Model: {settings.chatbot_model}) "
        f"supporting {user_full_name}. "
    )
    if attachment_context:
        attachment_kind = str(attachment_context.get("kind") or "")
        attachment_name = str(attachment_context.get("filename") or "attached-file")
        if attachment_kind == "pdf":
            attachment_excerpt = str(attachment_context.get("content") or "").strip()[:500]
            response_content += (
                f"I extracted text from `{attachment_name}` and can use it while answering.\n\n"
                f"PDF excerpt:\n{attachment_excerpt}\n\n"
                "Ask for a summary, theorem extraction, or a Lean formalization draft based on it."
            )
        else:
            response_content += (
                f"I received the image `{attachment_name}`. The mock provider cannot inspect image "
                "pixels, but Gemini mode can analyze the image directly."
            )
    elif rag_context:
        response_content += "I searched your indexed proofs and Lean files. Relevant context:\n\n"
        for item in rag_context[:3]:
            label = item.get("symbol_name") or item.get("module_name") or item.get("title")
            response_content += (
                f"- `{label}` from `{item.get('path') or item.get('title')}` "
                f"(lines {item.get('start_line')}-{item.get('end_line')}): "
                f"{item.get('content', '')[:220].strip()}\n"
            )
        response_content += "\nAsk about a specific symbol, theorem, or imported module for a narrower answer."
    elif code_context or any(token in user_msg for token in ("lean", "code", "theorem", "proof", "lemma")):
        language = str((code_context or {}).get("language") or "Lean4")
        base_code = str((code_context or {}).get("content") or "").strip()
        active_goal = str((code_context or {}).get("active_goal") or "").strip()
        cursor_line = (code_context or {}).get("cursor_line")
        if language.lower().startswith("lean"):
            suggested_code = (
                base_code
                if base_code
                else "import ShannonManifold\n\nexample : 1 = 1 := by\n  rfl"
            )
            if "example : 1 = 1 := by" not in suggested_code and "theorem" not in suggested_code:
                suggested_code = suggested_code.rstrip() + "\n\nexample : 1 = 1 := by\n  rfl\n"
            response_content += (
                (
                    f"I can see your current proof state near line {cursor_line}. "
                    f"Focused goal: {active_goal[:220]}. \n\n"
                    if active_goal
                    else "I can help co-write the Lean file from the current cursor position.\n\n"
                )
                + "Start from this draft and apply it to the playground if it fits.\n\n"
                f"```lean\n{suggested_code.strip()}\n```"
            )
            return {
                "reply": response_content,
                "provider": "mock",
                "model": settings.chatbot_model,
                "suggested_code": suggested_code.strip(),
                "suggested_language": "lean",
            }
        response_content += "I can help write code collaboratively when you attach the active file context."
    elif "pythagoras" in user_msg or "pythagorean" in user_msg:
        response_content += (
            "Searchable proof data is enabled, but I did not find an indexed chunk matching that query yet."
        )
    else:
        response_content += (
            "I can assist you with uploaded proofs, Lean4 modules, Rocq drafts, and formalization workflows. "
            "How can I help you today?"
        )

    return {
        "reply": response_content,
        "provider": "mock",
        "model": settings.chatbot_model,
    }


async def _generate_openai_compatible_reply(
    *,
    message: str,
    history: list[Any],
    user_full_name: str,
    settings: Settings,
    rag_context: list[dict[str, Any]] | None,
    code_context: dict[str, Any] | None,
    attachment_context: dict[str, Any] | None,
) -> dict[str, str]:
    if attachment_context and str(attachment_context.get("kind") or "") == "image":
        raise ChatProviderError(
            "Image attachments are only supported when CHATBOT_PROVIDER=gemini."
        )

    system_prompt = _build_system_prompt(
        settings=settings,
        user_full_name=user_full_name,
        rag_context=rag_context,
        code_context=code_context,
        attachment_context=attachment_context,
    )
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
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
            if exc.response.status_code in {401, 403} or _looks_like_invalid_openai_key(detail):
                raise ChatProviderConfigurationError(
                    _configuration_error_message("openai_compatible", "invalid")
                ) from exc
            raise ChatProviderError(f"Chat provider rejected the request: {detail}") from exc
        except httpx.HTTPError as exc:
            raise ChatProviderError(f"Chat provider request failed: {exc}") from exc

    reply = _extract_openai_compatible_text(response.json())
    suggested_code, suggested_language = _extract_suggested_code(reply)
    return {
        "reply": reply,
        "provider": "openai_compatible",
        "model": settings.chatbot_model,
        "suggested_code": suggested_code,
        "suggested_language": suggested_language,
    }


async def _generate_gemini_reply(
    *,
    message: str,
    history: list[Any],
    user_full_name: str,
    settings: Settings,
    rag_context: list[dict[str, Any]] | None,
    code_context: dict[str, Any] | None,
    attachment_context: dict[str, Any] | None,
) -> dict[str, str]:
    system_prompt = _build_system_prompt(
        settings=settings,
        user_full_name=user_full_name,
        rag_context=rag_context,
        code_context=code_context,
        attachment_context=attachment_context,
    )
    contents = [
        {
            "role": "user" if item["role"] == "user" else "model",
            "parts": [{"text": item["content"]}],
        }
        for item in _normalize_history(history, settings.chatbot_max_history_messages)
    ]
    user_parts: list[dict[str, Any]] = [
        {"text": message.strip() or "Please analyze the attached file."}
    ]
    if attachment_context and str(attachment_context.get("kind") or "") == "image":
        inline_data = str(attachment_context.get("data_base64") or "").strip()
        mime_type = str(attachment_context.get("mime_type") or "").strip()
        if inline_data and mime_type:
            user_parts.append(
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": inline_data,
                    }
                }
            )

    contents.append({"role": "user", "parts": user_parts})
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generation_config": {"temperature": settings.chatbot_temperature},
    }
    headers = {
        "x-goog-api-key": settings.chatbot_api_key,
        "Content-Type": "application/json",
        "x-goog-api-client": "shannon-manifold/1.0",
    }

    async with httpx.AsyncClient(timeout=settings.chatbot_timeout_seconds) as client:
        try:
            response = await client.post(
                f"{settings.chatbot_api_base_url}/models/{settings.chatbot_model}:generateContent",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.strip() or str(exc)
            if exc.response.status_code in {400, 401, 403} and _looks_like_invalid_gemini_key(detail):
                raise ChatProviderConfigurationError(
                    _configuration_error_message("gemini", "invalid")
                ) from exc
            raise ChatProviderError(f"Gemini rejected the request: {detail}") from exc
        except httpx.HTTPError as exc:
            raise ChatProviderError(f"Gemini request failed: {exc}") from exc

    reply = _extract_gemini_text(response.json())
    suggested_code, suggested_language = _extract_suggested_code(reply)
    return {
        "reply": reply,
        "provider": "gemini",
        "model": settings.chatbot_model,
        "suggested_code": suggested_code,
        "suggested_language": suggested_language,
    }


async def generate_chat_reply(
    *,
    message: str,
    history: list[Any],
    user_full_name: str,
    settings: Settings,
    rag_context: list[dict[str, Any]] | None = None,
    code_context: dict[str, Any] | None = None,
    attachment_context: dict[str, Any] | None = None,
) -> dict[str, str]:
    provider = settings.chatbot_provider

    if provider == "mock":
        await asyncio.sleep(0.35)
        return build_mock_chat_reply(
            message=message,
            history=history,
            user_full_name=user_full_name,
            settings=settings,
            rag_context=rag_context,
            code_context=code_context,
            attachment_context=attachment_context,
        )

    if not settings.chatbot_api_key:
        raise ChatProviderConfigurationError(_configuration_error_message(provider, "missing"))
    if _is_placeholder_api_key(settings.chatbot_api_key):
        raise ChatProviderConfigurationError(_configuration_error_message(provider, "invalid"))

    if provider == "openai_compatible":
        return await _generate_openai_compatible_reply(
            message=message,
            history=history,
            user_full_name=user_full_name,
            settings=settings,
            rag_context=rag_context,
            code_context=code_context,
            attachment_context=attachment_context,
        )

    if provider == "gemini":
        return await _generate_gemini_reply(
            message=message,
            history=history,
            user_full_name=user_full_name,
            settings=settings,
            rag_context=rag_context,
            code_context=code_context,
            attachment_context=attachment_context,
        )

    raise ChatProviderError(f"Unsupported CHATBOT_PROVIDER: {provider}")
