from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from config import Settings
from models.code_document import CodeDocument
from models.proof_workspace import ProofWorkspace
from services.chat_provider import (
    ChatProviderError,
    _extract_gemini_text,
    _extract_openai_compatible_text,
)

TOP_LEVEL_DECLARATION_RE = re.compile(
    r"^\s*(theorem|lemma|def|structure|inductive|class|abbrev|instance)\s+([A-Za-z0-9_'.]+)"
)
TOKEN_RE = re.compile(r"[A-Za-z0-9_'.]+")
PAGE_MARKER_RE = re.compile(r"^\[Page\s+(\d+)\]\s*$")
MAPPING_CACHE_KEY = "pdf_lean_mapping_v1"


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text)]


def _build_local_embedding(text: str, vector_size: int = 192) -> list[float]:
    vector = [0.0] * vector_size
    tokens = _tokenize(text)
    if not tokens:
        return vector

    for token in tokens:
        digest = hashlib.sha1(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % vector_size
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        weight = 1.0 + math.log1p(len(token))
        vector[index] += sign * weight

    norm = math.sqrt(sum(component * component for component in vector))
    if norm == 0:
        return vector
    return [component / norm for component in vector]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return float(sum(a * b for a, b in zip(left, right)))


def _parse_document_metadata(document: CodeDocument) -> dict[str, Any]:
    try:
        parsed = json.loads(document.metadata_json or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _write_document_metadata(document: CodeDocument, metadata: dict[str, Any]) -> None:
    document.metadata_json = json.dumps(metadata)


def _extract_declaration_blocks(document: CodeDocument) -> list[dict[str, Any]]:
    lines = document.content.splitlines()
    if not lines:
        return []

    blocks: list[dict[str, Any]] = []
    current_start = 1
    current_kind = "module"
    current_symbol = document.module_name or document.title

    def append_block(end_line: int) -> None:
        nonlocal current_start, current_kind, current_symbol
        if end_line < current_start:
            return
        chunk_lines = lines[current_start - 1 : end_line]
        chunk_text = "\n".join(chunk_lines).strip()
        if not chunk_text:
            return
        if current_kind == "module":
            return
        blocks.append(
            {
                "id": f"{current_symbol}:{current_start}",
                "declaration_kind": current_kind,
                "symbol_name": current_symbol,
                "start_line": current_start,
                "end_line": end_line,
                "content": chunk_text[:1800],
            }
        )

    for line_number, line in enumerate(lines, start=1):
        match = TOP_LEVEL_DECLARATION_RE.match(line)
        if match and line_number != current_start:
            append_block(line_number - 1)
            current_start = line_number
            current_kind = match.group(1)
            current_symbol = match.group(2)
        elif match:
            current_kind = match.group(1)
            current_symbol = match.group(2)

    append_block(len(lines))
    return blocks


def _split_into_sentences(text: str) -> list[str]:
    compact = " ".join(text.split())
    if not compact:
        return []
    sentences = re.split(r"(?<=[.!?])\s+", compact)
    return [sentence.strip() for sentence in sentences if sentence.strip()]


def _extract_pdf_segments(extracted_text: str) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    current_page: int | None = None
    current_lines: list[str] = []

    def flush_page() -> None:
        if current_page is None:
            return
        page_text = "\n".join(current_lines).strip()
        if not page_text:
            return
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", page_text) if part.strip()]
        candidate_units = paragraphs if paragraphs else _split_into_sentences(page_text)
        if not candidate_units:
            candidate_units = [page_text]

        for index, unit in enumerate(candidate_units, start=1):
            compact = " ".join(unit.split())
            if len(compact) < 40:
                continue
            segments.append(
                {
                    "id": f"p{current_page}-s{index}",
                    "page": current_page,
                    "text": compact[:520],
                }
            )

    for raw_line in extracted_text.splitlines():
        page_match = PAGE_MARKER_RE.match(raw_line.strip())
        if page_match:
            flush_page()
            current_page = int(page_match.group(1))
            current_lines = []
            continue
        current_lines.append(raw_line)
    flush_page()

    return segments


def _choose_candidate_segments(
    declarations: list[dict[str, Any]],
    segments: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    segment_vectors = {
        segment["id"]: _build_local_embedding(segment["text"])
        for segment in segments
    }
    shortlisted: dict[str, list[dict[str, Any]]] = {}

    for declaration in declarations:
        declaration_vector = _build_local_embedding(
            f'{declaration["symbol_name"]}\n{declaration["content"]}'
        )
        scored = []
        for segment in segments:
            score = _cosine_similarity(declaration_vector, segment_vectors[segment["id"]])
            if score <= 0:
                continue
            scored.append(
                {
                    "id": segment["id"],
                    "page": segment["page"],
                    "text": segment["text"],
                    "score": round(score, 4),
                }
            )
        scored.sort(key=lambda item: item["score"], reverse=True)
        shortlisted[declaration["id"]] = scored[:4]

    return shortlisted


def _is_placeholder_api_key(api_key: str) -> bool:
    lowered = api_key.strip().lower()
    return not lowered or lowered.startswith("your-") or "placeholder" in lowered


def _strip_json_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[A-Za-z0-9_-]*\n", "", stripped)
        stripped = re.sub(r"\n```$", "", stripped)
    return stripped.strip()


async def _request_mapping_via_provider(
    settings: Settings,
    declarations: list[dict[str, Any]],
    candidate_segments: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]] | None:
    if _is_placeholder_api_key(settings.chatbot_api_key):
        return None

    prompt = (
        "Map each Lean declaration to the single best matching PDF excerpt candidate.\n"
        "Only use the provided candidates.\n"
        "If none fit, return null for segment_id.\n"
        "Return strict JSON with shape {\"mappings\":[{\"declaration_id\":string,\"segment_id\":string|null,\"confidence\":number,\"reason\":string}]}.\n\n"
        "Declarations:\n"
        f"{json.dumps(declarations, ensure_ascii=True)}\n\n"
        "Candidate PDF excerpts by declaration:\n"
        f"{json.dumps(candidate_segments, ensure_ascii=True)}"
    )

    provider = settings.chatbot_provider
    timeout = settings.chatbot_timeout_seconds

    if provider == "gemini":
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }
        headers = {"Content-Type": "application/json"}
        params = {"key": settings.chatbot_api_key}
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{settings.chatbot_api_base_url}/models/{settings.chatbot_model}:generateContent",
                json=payload,
                headers=headers,
                params=params,
            )
            response.raise_for_status()
        raw_text = _extract_gemini_text(response.json())
    elif provider == "openai_compatible":
        payload = {
            "model": settings.chatbot_model,
            "temperature": 0.1,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {settings.chatbot_api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{settings.chatbot_api_base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
        raw_text = _extract_openai_compatible_text(response.json())
    else:
        return None

    payload = json.loads(_strip_json_fence(raw_text))
    mappings = payload.get("mappings")
    if not isinstance(mappings, list):
        raise ChatProviderError("PDF mapping provider returned an invalid JSON payload.")
    return mappings


def _heuristic_mapping(
    declarations: list[dict[str, Any]],
    candidate_segments: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    mappings: list[dict[str, Any]] = []
    for declaration in declarations:
        candidates = candidate_segments.get(declaration["id"], [])
        if not candidates:
            continue
        top_candidate = candidates[0]
        if float(top_candidate["score"]) < 0.06:
            continue
        mappings.append(
            {
                "declaration_id": declaration["id"],
                "segment_id": top_candidate["id"],
                "confidence": min(0.95, max(0.15, float(top_candidate["score"]) * 3.5)),
                "reason": "Selected via lexical similarity between the Lean declaration and extracted PDF text.",
            }
        )
    return mappings


def _materialize_mapping_items(
    declarations: list[dict[str, Any]],
    segments: list[dict[str, Any]],
    raw_mappings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    declarations_by_id = {declaration["id"]: declaration for declaration in declarations}
    segments_by_id = {segment["id"]: segment for segment in segments}
    items: list[dict[str, Any]] = []

    for raw_item in raw_mappings:
        declaration = declarations_by_id.get(str(raw_item.get("declaration_id") or ""))
        segment_id = raw_item.get("segment_id")
        if declaration is None or segment_id is None:
            continue
        segment = segments_by_id.get(str(segment_id))
        if segment is None:
            continue
        confidence = raw_item.get("confidence")
        items.append(
            {
                "symbol_name": declaration["symbol_name"],
                "declaration_kind": declaration["declaration_kind"],
                "start_line": declaration["start_line"],
                "end_line": declaration["end_line"],
                "pdf_page": segment["page"],
                "pdf_excerpt": segment["text"],
                "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
                "reason": str(raw_item.get("reason") or "").strip() or None,
            }
        )

    items.sort(key=lambda item: (item["start_line"], item["symbol_name"]))
    return items


async def get_or_generate_pdf_mapping(
    db: Session,
    *,
    settings: Settings,
    document: CodeDocument,
    workspace: ProofWorkspace,
) -> dict[str, Any]:
    metadata = _parse_document_metadata(document)
    extracted_text = workspace.extracted_text or workspace.source_text or ""
    input_hash = _hash_text(f"{document.content}\n\n{extracted_text}")

    cached = metadata.get(MAPPING_CACHE_KEY)
    if isinstance(cached, dict) and cached.get("input_hash") == input_hash:
        items = cached.get("items")
        if isinstance(items, list):
            return {
                "generated_at": cached.get("generated_at"),
                "items": items,
            }

    declarations = _extract_declaration_blocks(document)
    segments = _extract_pdf_segments(extracted_text)
    if not declarations or not segments:
        payload = {
            "generated_at": None,
            "items": [],
        }
        metadata[MAPPING_CACHE_KEY] = {
            "input_hash": input_hash,
            "generated_at": None,
            "items": [],
        }
        _write_document_metadata(document, metadata)
        db.flush()
        return payload

    candidates = _choose_candidate_segments(declarations, segments)
    declaration_prompt_items = [
        {
            "id": declaration["id"],
            "declaration_kind": declaration["declaration_kind"],
            "symbol_name": declaration["symbol_name"],
            "start_line": declaration["start_line"],
            "end_line": declaration["end_line"],
            "content": declaration["content"][:500],
        }
        for declaration in declarations
    ]

    raw_mappings: list[dict[str, Any]] | None = None
    try:
        raw_mappings = await _request_mapping_via_provider(
            settings,
            declaration_prompt_items,
            candidates,
        )
    except Exception:
        raw_mappings = None
    if raw_mappings is None:
        raw_mappings = _heuristic_mapping(declarations, candidates)

    items = _materialize_mapping_items(declarations, segments, raw_mappings)
    generated_at = datetime.now(timezone.utc).isoformat() if items else None
    cache_payload = {
        "input_hash": input_hash,
        "generated_at": generated_at,
        "items": items,
    }
    metadata[MAPPING_CACHE_KEY] = cache_payload
    _write_document_metadata(document, metadata)
    db.flush()
    return {
        "generated_at": generated_at,
        "items": items,
    }
