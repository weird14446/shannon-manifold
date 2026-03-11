from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any

import httpx
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from sqlalchemy import or_
from sqlalchemy.orm import Session

from config import Settings
from models.code_chunk import CodeChunk
from models.code_document import CodeDocument
from models.proof_workspace import ProofWorkspace
from services.lean_workspace import delete_workspace_file, resolve_workspace_target, write_workspace_file

TOP_LEVEL_DECLARATION_RE = re.compile(
    r"^\s*(theorem|lemma|def|structure|inductive|class|abbrev|instance)\s+([A-Za-z0-9_'.]+)"
)
IMPORT_RE = re.compile(r"^\s*import\s+(.+?)\s*$")
TOKEN_RE = re.compile(r"[A-Za-z0-9_'.]+")


def _tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text)]


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def extract_imports_from_content(content: str) -> list[str]:
    imports: list[str] = []
    for line in content.splitlines():
        match = IMPORT_RE.match(line)
        if not match:
            continue
        for module in match.group(1).split():
            cleaned = module.strip().rstrip(",")
            if cleaned:
                imports.append(cleaned)
    return imports


def _chunk_lean_document(
    *,
    title: str,
    path: str | None,
    module_name: str | None,
    content: str,
    summary_text: str,
) -> list[dict[str, Any]]:
    lines = content.splitlines()
    if not lines:
        lines = [""]

    chunks: list[dict[str, Any]] = []
    current_start = 1
    current_kind = "module"
    current_symbol = module_name or title

    def append_chunk(end_line: int) -> None:
        nonlocal current_start, current_kind, current_symbol
        if end_line < current_start:
            return
        chunk_lines = lines[current_start - 1 : end_line]
        chunk_body = "\n".join(chunk_lines).strip()
        if not chunk_body:
            return

        search_parts = [title, module_name or "", path or "", current_symbol or "", summary_text, chunk_body]
        chunks.append(
            {
                "chunk_kind": current_kind,
                "symbol_name": current_symbol,
                "start_line": current_start,
                "end_line": end_line,
                "chunk_text": chunk_body,
                "search_text": "\n".join(part for part in search_parts if part).strip(),
            }
        )

    for line_number, line in enumerate(lines, start=1):
        match = TOP_LEVEL_DECLARATION_RE.match(line)
        if match and line_number != current_start:
            append_chunk(line_number - 1)
            current_start = line_number
            current_kind = match.group(1)
            current_symbol = match.group(2)
        elif match:
            current_kind = match.group(1)
            current_symbol = match.group(2)

    append_chunk(len(lines))

    if not chunks:
        full_text = "\n".join(lines).strip()
        chunks.append(
            {
                "chunk_kind": "module",
                "symbol_name": module_name or title,
                "start_line": 1,
                "end_line": len(lines),
                "chunk_text": full_text,
                "search_text": "\n".join(
                    part for part in [title, module_name or "", path or "", summary_text, full_text] if part
                ).strip(),
            }
        )

    return chunks


def build_local_embedding(text: str, vector_size: int) -> list[float]:
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


async def embed_text(settings: Settings, text: str) -> list[float]:
    if settings.embedding_provider != "openai_compatible" or not settings.embedding_api_key:
        return build_local_embedding(text, settings.embedding_vector_size)

    headers = {
        "Authorization": f"Bearer {settings.embedding_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.embedding_model,
        "input": text,
    }

    async with httpx.AsyncClient(timeout=settings.embedding_timeout_seconds) as client:
        response = await client.post(
            f"{settings.embedding_api_base_url}/embeddings",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()

    data = response.json()
    embedding = data["data"][0]["embedding"]
    if len(embedding) > settings.embedding_vector_size:
        embedding = embedding[: settings.embedding_vector_size]
    elif len(embedding) < settings.embedding_vector_size:
        embedding = [*embedding, *([0.0] * (settings.embedding_vector_size - len(embedding)))]
    return embedding


def get_qdrant_client(settings: Settings) -> QdrantClient | None:
    if not settings.qdrant_url:
        return None

    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key or None,
        timeout=10.0,
        check_compatibility=False,
    )


def ensure_rag_collection(settings: Settings) -> None:
    client = get_qdrant_client(settings)
    if client is None:
        return

    collections = client.get_collections().collections
    if any(collection.name == settings.qdrant_collection_name for collection in collections):
        return

    client.create_collection(
        collection_name=settings.qdrant_collection_name,
        vectors_config=qdrant_models.VectorParams(
            size=settings.embedding_vector_size,
            distance=qdrant_models.Distance.COSINE,
        ),
    )


async def _reindex_chunks(
    db: Session,
    *,
    settings: Settings,
    document: CodeDocument,
    owner_id: int | None,
    chunk_specs: list[dict[str, Any]],
) -> None:
    existing_chunks = db.query(CodeChunk).filter(CodeChunk.document_id == document.id).all()
    existing_vector_ids = [chunk.vector_id for chunk in existing_chunks]

    if existing_chunks:
        db.query(CodeChunk).filter(CodeChunk.document_id == document.id).delete()
        db.flush()

    client = get_qdrant_client(settings)
    if client is not None and existing_vector_ids:
        try:
            client.delete(
                collection_name=settings.qdrant_collection_name,
                points_selector=qdrant_models.PointIdsList(points=existing_vector_ids),
            )
        except Exception:
            client = None

    point_batch: list[qdrant_models.PointStruct] = []

    for index, chunk_spec in enumerate(chunk_specs):
        vector_id = f"doc-{document.id}-chunk-{index}"
        chunk = CodeChunk(
            document_id=document.id,
            owner_id=owner_id,
            vector_id=vector_id,
            chunk_index=index,
            chunk_kind=chunk_spec["chunk_kind"],
            symbol_name=chunk_spec["symbol_name"],
            start_line=chunk_spec["start_line"],
            end_line=chunk_spec["end_line"],
            chunk_text=chunk_spec["chunk_text"],
            search_text=chunk_spec["search_text"],
        )
        db.add(chunk)

        if client is not None:
            embedding = await embed_text(settings, chunk.search_text)
            point_batch.append(
                qdrant_models.PointStruct(
                    id=vector_id,
                    vector=embedding,
                    payload={
                        "document_id": document.id,
                        "owner_id": owner_id,
                        "title": document.title,
                        "module_name": document.module_name,
                        "path": document.path,
                        "symbol_name": chunk.symbol_name,
                        "chunk_kind": chunk.chunk_kind,
                    },
                )
            )

    db.flush()

    if client is not None and point_batch:
        try:
            client.upsert(collection_name=settings.qdrant_collection_name, points=point_batch)
        except Exception:
            pass


def _delete_qdrant_points(settings: Settings, vector_ids: list[str]) -> None:
    if not vector_ids:
        return

    client = get_qdrant_client(settings)
    if client is None:
        return

    try:
        client.delete(
            collection_name=settings.qdrant_collection_name,
            points_selector=qdrant_models.PointIdsList(points=vector_ids),
        )
    except Exception:
        pass


async def upsert_indexed_document(
    db: Session,
    *,
    settings: Settings,
    document: CodeDocument | None = None,
    owner_id: int | None,
    title: str,
    path: str | None,
    module_name: str | None,
    language: str,
    source_kind: str,
    source_ref_id: int | None,
    content: str,
    summary_text: str = "",
    is_verified: bool = False,
) -> CodeDocument:
    if document is None:
        query = db.query(CodeDocument).filter(
            CodeDocument.source_kind == source_kind,
            CodeDocument.owner_id.is_(None) if owner_id is None else CodeDocument.owner_id == owner_id,
        )
        if source_ref_id is not None:
            query = query.filter(CodeDocument.source_ref_id == source_ref_id)
        elif path is not None:
            query = query.filter(CodeDocument.path == path)

        document = query.first()

    if document is None:
        document = CodeDocument(
            owner_id=owner_id,
            source_kind=source_kind,
            source_ref_id=source_ref_id,
        )
        db.add(document)

    previous_path = document.path
    document.title = title
    document.path = path
    document.module_name = module_name
    document.language = language
    document.summary_text = summary_text
    document.content = content
    document.sha256 = _hash_text(content)
    document.is_verified = is_verified
    document.metadata_json = json.dumps(
        {
            "imports": extract_imports_from_content(content),
        }
    )
    db.flush()

    if previous_path and previous_path != path and owner_id is not None:
        delete_workspace_file(settings, relative_path=previous_path)

    chunk_specs = _chunk_lean_document(
        title=title,
        path=path,
        module_name=module_name,
        content=content,
        summary_text=summary_text,
    )
    await _reindex_chunks(
        db,
        settings=settings,
        document=document,
        owner_id=owner_id,
        chunk_specs=chunk_specs,
    )
    db.flush()
    return document


def delete_indexed_document(
    db: Session,
    *,
    settings: Settings,
    document: CodeDocument,
    remove_workspace_file: bool = False,
) -> None:
    existing_chunks = db.query(CodeChunk).filter(CodeChunk.document_id == document.id).all()
    vector_ids = [chunk.vector_id for chunk in existing_chunks]
    if existing_chunks:
        db.query(CodeChunk).filter(CodeChunk.document_id == document.id).delete()

    if remove_workspace_file and document.owner_id is not None:
        delete_workspace_file(settings, relative_path=document.path)

    db.delete(document)
    db.flush()
    _delete_qdrant_points(settings, vector_ids)


def cleanup_missing_workspace_documents(
    db: Session,
    *,
    settings: Settings,
) -> int:
    workspace_root = settings.lean_workspace_dir.resolve()
    documents = (
        db.query(CodeDocument)
        .filter(
            CodeDocument.owner_id.isnot(None),
            CodeDocument.path.isnot(None),
            CodeDocument.source_kind.in_(("proof_workspace", "playground")),
        )
        .all()
    )

    removed_count = 0
    for document in documents:
        candidate = (workspace_root / (document.path or "")).resolve()
        if candidate.exists():
            continue

        delete_indexed_document(
            db,
            settings=settings,
            document=document,
            remove_workspace_file=False,
        )
        removed_count += 1

    return removed_count


async def sync_proof_workspace_to_rag(
    db: Session,
    *,
    settings: Settings,
    workspace: ProofWorkspace,
    saved_path: str,
    saved_module: str,
    document: CodeDocument | None = None,
) -> CodeDocument:
    summary_source = workspace.extracted_text or workspace.source_text or ""
    summary_text = summary_source[:3000]
    return await upsert_indexed_document(
        db,
        settings=settings,
        document=document,
        owner_id=workspace.owner_id,
        title=workspace.title,
        path=saved_path,
        module_name=saved_module,
        language="Lean4",
        source_kind="proof_workspace",
        source_ref_id=workspace.id,
        content=workspace.lean4_code,
        summary_text=summary_text,
        is_verified=True,
    )


async def sync_playground_document_to_rag(
    db: Session,
    *,
    settings: Settings,
    owner_id: int,
    title: str,
    saved_path: str,
    saved_module: str,
    content: str,
    document: CodeDocument | None = None,
) -> CodeDocument:
    return await upsert_indexed_document(
        db,
        settings=settings,
        document=document,
        owner_id=owner_id,
        title=title,
        path=saved_path,
        module_name=saved_module,
        language="Lean4",
        source_kind="playground",
        source_ref_id=None,
        content=content,
        summary_text=title,
        is_verified=True,
    )


async def sync_workspace_seed_documents(db: Session, settings: Settings) -> None:
    stale_seed_documents = (
        db.query(CodeDocument)
        .filter(CodeDocument.source_kind == "lean_workspace_seed")
        .all()
    )
    for document in stale_seed_documents:
        delete_indexed_document(db, settings=settings, document=document, remove_workspace_file=False)


async def sync_existing_proof_documents(db: Session, settings: Settings) -> None:
    existing_documents = (
        db.query(CodeDocument)
        .filter(CodeDocument.source_kind == "proof_workspace")
        .all()
    )
    document_lookup = {
        document.source_ref_id: document
        for document in existing_documents
        if document.source_ref_id is not None
    }

    workspaces = (
        db.query(ProofWorkspace)
        .order_by(ProofWorkspace.updated_at.desc(), ProofWorkspace.id.desc())
        .all()
    )

    for workspace in workspaces:
        if not workspace.lean4_code.strip():
            continue

        document = document_lookup.get(workspace.id)
        fallback_target = resolve_workspace_target(settings, workspace.title)
        candidate_targets: list[tuple[str, str]] = []
        if document is not None and document.path:
            candidate_targets.append(
                (
                    document.path,
                    document.module_name or fallback_target["module"],
                )
            )
        candidate_targets.append((fallback_target["path"], fallback_target["module"]))

        existing_target: tuple[str, str] | None = None
        for candidate_path, candidate_module in candidate_targets:
            if (settings.lean_workspace_dir / candidate_path).exists():
                existing_target = (candidate_path, candidate_module)
                break

        if existing_target is None:
            continue

        saved_path, saved_module = existing_target
        workspace.lean4_code = (settings.lean_workspace_dir / saved_path).read_text(encoding="utf-8")
        await sync_proof_workspace_to_rag(
            db,
            settings=settings,
            workspace=workspace,
            saved_path=saved_path,
            saved_module=saved_module,
            document=document,
        )


def _lexical_score(query_tokens: list[str], chunk: CodeChunk, document: CodeDocument) -> float:
    haystack = chunk.search_text.lower()
    score = 0.0
    for token in query_tokens:
        if token in (document.module_name or "").lower():
            score += 3.0
        if token in (document.title or "").lower():
            score += 2.0
        if token in (chunk.symbol_name or "").lower():
            score += 2.5
        if token in haystack:
            score += 1.0
    return score


async def retrieve_rag_context(
    db: Session,
    *,
    settings: Settings,
    owner_id: int,
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    query_tokens = _tokenize(query)
    chunk_rows = (
        db.query(CodeChunk, CodeDocument)
        .join(CodeDocument, CodeDocument.id == CodeChunk.document_id)
        .filter(or_(CodeDocument.owner_id == owner_id, CodeDocument.owner_id.is_(None)))
        .all()
    )

    scored_items: dict[str, dict[str, Any]] = {}

    for chunk, document in chunk_rows:
        lexical_score = _lexical_score(query_tokens, chunk, document)
        if lexical_score <= 0:
            continue
        scored_items[chunk.vector_id] = {
            "score": lexical_score,
            "document": document,
            "chunk": chunk,
        }

    client = get_qdrant_client(settings)
    if client is not None:
        try:
            embedding = await embed_text(settings, query)
            vector_hits = client.search(
                collection_name=settings.qdrant_collection_name,
                query_vector=embedding,
                limit=max(limit * 3, 10),
            )
            hit_ids = [str(hit.id) for hit in vector_hits]
            hit_chunks = (
                db.query(CodeChunk, CodeDocument)
                .join(CodeDocument, CodeDocument.id == CodeChunk.document_id)
                .filter(CodeChunk.vector_id.in_(hit_ids))
                .filter(or_(CodeDocument.owner_id == owner_id, CodeDocument.owner_id.is_(None)))
                .all()
            )
            score_map = {str(hit.id): float(hit.score or 0.0) for hit in vector_hits}
            for chunk, document in hit_chunks:
                existing = scored_items.get(chunk.vector_id)
                vector_score = score_map.get(chunk.vector_id, 0.0) * 5.0
                combined = vector_score + (existing["score"] if existing else 0.0)
                scored_items[chunk.vector_id] = {
                    "score": combined,
                    "document": document,
                    "chunk": chunk,
                }
        except Exception:
            pass

    ranked = sorted(scored_items.values(), key=lambda item: item["score"], reverse=True)
    contexts: list[dict[str, Any]] = []
    seen_chunks: set[tuple[str | None, str | None, int, int]] = set()
    for item in ranked:
        document = item["document"]
        chunk = item["chunk"]
        dedupe_key = (document.path, chunk.symbol_name, chunk.start_line, chunk.end_line)
        if dedupe_key in seen_chunks:
            continue
        seen_chunks.add(dedupe_key)
        contexts.append(
            {
                "title": document.title,
                "module_name": document.module_name,
                "path": document.path,
                "symbol_name": chunk.symbol_name,
                "chunk_kind": chunk.chunk_kind,
                "start_line": chunk.start_line,
                "end_line": chunk.end_line,
                "content": chunk.chunk_text,
                "summary": document.summary_text,
                "score": round(item["score"], 3),
            }
        )
        if len(contexts) >= limit:
            break

    return contexts


def build_import_graph(
    db: Session,
    *,
    owner_id: int | None,
) -> dict[str, list[dict[str, Any]]]:
    _ = owner_id
    query = db.query(CodeDocument).filter(
        CodeDocument.language == "Lean4",
        CodeDocument.is_verified.is_(True),
        CodeDocument.owner_id.isnot(None),
        CodeDocument.source_kind.in_(("proof_workspace", "playground")),
    )

    documents = query.order_by(CodeDocument.module_name.asc(), CodeDocument.id.asc()).all()
    nodes: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    module_index: dict[str, CodeDocument] = {}

    for document in documents:
        module_name = document.module_name or document.title
        existing = module_index.get(module_name)
        if existing is not None and existing.owner_id is None and document.owner_id is not None:
            module_index[module_name] = document
        elif existing is None:
            module_index[module_name] = document

    for module_name, document in module_index.items():
        metadata = json.loads(document.metadata_json or "{}")
        imports = metadata.get("imports", [])
        nodes.append(
            {
                "id": module_name,
                "label": module_name.split(".")[-1],
                "module_name": module_name,
                "path": document.path,
                "title": document.title,
                "imports": len(imports),
                "source_kind": document.source_kind,
            }
        )

    for module_name, document in module_index.items():
        metadata = json.loads(document.metadata_json or "{}")
        for imported_module in metadata.get("imports", []):
            target = module_index.get(imported_module)
            if target is None:
                continue
            links.append(
                {
                    "source": module_name,
                    "target": imported_module,
                    "type": "import",
                }
            )

    return {"nodes": nodes, "links": links}
