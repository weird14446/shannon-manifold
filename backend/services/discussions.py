from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from config import Settings
from models.code_document import CodeDocument
from models.proof_workspace import ProofWorkspace
from models.user import User
from services.project_workspace import (
    accessible_project_roots,
    canonicalize_project_root,
    owner_slug_for_user,
    read_project_readme,
)

DISCUSSION_SCOPE_TYPES = {"theorem", "project"}
DISCUSSION_STATUSES = {"open", "resolved"}
DISCUSSION_ANCHOR_TYPES = {
    "general",
    "lean_decl",
    "pdf_page",
    "project_readme",
}
THEOREM_SCOPE_RE = re.compile(r"^theorem:(\d+)$")
PROJECT_SCOPE_RE = re.compile(r"^project:(.+)$")


class DiscussionError(RuntimeError):
    pass


class DiscussionNotFoundError(DiscussionError):
    pass


class DiscussionValidationError(DiscussionError):
    pass


@dataclass(slots=True)
class DiscussionScopeContext:
    scope_type: str
    scope_key: str
    current_user: User | None
    theorem_document: CodeDocument | None = None
    theorem_workspace: ProofWorkspace | None = None
    project_root: str | None = None
    project_owner_slug: str | None = None
    readme_path: str | None = None
    readme_content: str | None = None
    can_resolve: bool = False
    can_comment: bool = False


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def parse_anchor_json(raw_value: str | None) -> dict[str, Any]:
    try:
        payload = json.loads(raw_value or "{}")
    except (TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def dump_anchor_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True)


def canonical_scope_key(scope_type: str, scope_key: str) -> str:
    normalized_scope_type = scope_type.strip().lower()
    if normalized_scope_type not in DISCUSSION_SCOPE_TYPES:
        raise DiscussionValidationError("Unsupported discussion scope type.")

    if normalized_scope_type == "theorem":
        match = THEOREM_SCOPE_RE.fullmatch(scope_key.strip())
        if not match:
            raise DiscussionValidationError("Theorem scope key must look like theorem:{document_id}.")
        return f"theorem:{int(match.group(1))}"

    match = PROJECT_SCOPE_RE.fullmatch(scope_key.strip())
    if not match:
        raise DiscussionValidationError("Project scope key must look like project:{project_root}.")
    return f"project:{canonicalize_project_root(match.group(1))}"


def resolve_scope_context(
    db: Session,
    *,
    settings: Settings,
    scope_type: str,
    scope_key: str,
    current_user: User | None,
) -> DiscussionScopeContext:
    normalized_scope_key = canonical_scope_key(scope_type, scope_key)
    requester_user_id = current_user.id if current_user else None

    if scope_type == "theorem":
        match = THEOREM_SCOPE_RE.fullmatch(normalized_scope_key)
        assert match is not None
        document_id = int(match.group(1))
        visible_project_roots = accessible_project_roots(settings, requester_user_id=requester_user_id)
        document = (
            db.query(CodeDocument)
            .filter(
                CodeDocument.id == document_id,
                CodeDocument.is_verified.is_(True),
                CodeDocument.owner_id.isnot(None),
                CodeDocument.source_kind.in_(("proof_workspace", "playground")),
            )
            .first()
        )
        if document is None:
            raise DiscussionNotFoundError("Discussion scope not found.")

        metadata = parse_anchor_json(document.metadata_json)
        project_root = metadata.get("project_root")
        if isinstance(project_root, str) and project_root and project_root not in visible_project_roots:
            raise DiscussionNotFoundError("Discussion scope not found.")

        workspace = None
        if document.source_kind == "proof_workspace" and document.source_ref_id is not None:
            workspace = (
                db.query(ProofWorkspace)
                .filter(ProofWorkspace.id == document.source_ref_id)
                .first()
            )

        return DiscussionScopeContext(
            scope_type="theorem",
            scope_key=normalized_scope_key,
            current_user=current_user,
            theorem_document=document,
            theorem_workspace=workspace,
            can_resolve=bool(current_user and (current_user.is_admin or document.owner_id == current_user.id)),
            can_comment=current_user is not None,
        )

    match = PROJECT_SCOPE_RE.fullmatch(normalized_scope_key)
    assert match is not None
    project_root = canonicalize_project_root(match.group(1))
    visible_project_roots = accessible_project_roots(settings, requester_user_id=requester_user_id)
    if project_root not in visible_project_roots:
        raise DiscussionNotFoundError("Discussion scope not found.")

    parts = project_root.split("/")
    if len(parts) < 3:
        raise DiscussionNotFoundError("Discussion scope not found.")
    owner_slug = parts[1]

    try:
        readme_path, readme_content = read_project_readme(settings, project_root=project_root)
    except Exception as exc:
        raise DiscussionNotFoundError("Discussion scope not found.") from exc

    return DiscussionScopeContext(
        scope_type="project",
        scope_key=f"project:{project_root}",
        current_user=current_user,
        project_root=project_root,
        project_owner_slug=owner_slug,
        readme_path=readme_path,
        readme_content=readme_content,
        can_resolve=bool(
            current_user
            and (
                current_user.is_admin
                or owner_slug_for_user(current_user.id) == owner_slug
            )
        ),
        can_comment=current_user is not None,
    )


def anchor_key_for_payload(anchor_type: str, anchor_json: dict[str, Any]) -> str:
    if anchor_type == "general":
        return "general"
    if anchor_type == "lean_decl":
        return (
            f"lean_decl:{int(anchor_json['document_id'])}:{anchor_json['symbol_name']}:"
            f"{int(anchor_json['start_line'])}:{int(anchor_json['end_line'])}"
        )
    if anchor_type == "pdf_page":
        symbol_name = str(anchor_json.get("symbol_name") or "")
        start_line = int(anchor_json.get("start_line") or 0)
        return (
            f"pdf_page:{int(anchor_json['document_id'])}:{int(anchor_json['pdf_page'])}:"
            f"{symbol_name}:{start_line}"
        )
    if anchor_type == "project_readme":
        return f"project_readme:{anchor_json['project_root']}:{anchor_json['readme_path']}"
    raise DiscussionValidationError("Unsupported discussion anchor type.")


def build_anchor_label(anchor_type: str, anchor_json: dict[str, Any]) -> str:
    if anchor_type == "general":
        return "General discussion"
    if anchor_type == "lean_decl":
        return (
            f"{anchor_json['declaration_kind']} {anchor_json['symbol_name']} · "
            f"L{anchor_json['start_line']}-L{anchor_json['end_line']}"
        )
    if anchor_type == "pdf_page":
        symbol_name = str(anchor_json.get("symbol_name") or "").strip()
        if symbol_name:
            return f"PDF page {anchor_json['pdf_page']} · {symbol_name}"
        return f"PDF page {anchor_json['pdf_page']}"
    if anchor_type == "project_readme":
        return str(anchor_json.get("readme_path") or "README.md")
    raise DiscussionValidationError("Unsupported discussion anchor type.")


def anchor_is_outdated(scope: DiscussionScopeContext, anchor_type: str, anchor_json: dict[str, Any]) -> bool:
    if anchor_type == "lean_decl" and scope.theorem_document is not None:
        return str(anchor_json.get("document_sha256") or "") != scope.theorem_document.sha256
    if anchor_type == "pdf_page" and scope.theorem_document is not None:
        return str(anchor_json.get("document_sha256") or "") != scope.theorem_document.sha256
    if anchor_type == "project_readme":
        current_hash = sha256_text(scope.readme_content or "")
        return str(anchor_json.get("readme_sha256") or "") != current_hash
    return False


def normalize_anchor(
    scope: DiscussionScopeContext,
    *,
    anchor_type: str,
    anchor_json: dict[str, Any] | None,
) -> dict[str, Any]:
    normalized_type = anchor_type.strip().lower()
    if normalized_type not in DISCUSSION_ANCHOR_TYPES:
        raise DiscussionValidationError("Unsupported discussion anchor type.")

    payload = anchor_json or {}
    if not isinstance(payload, dict):
        raise DiscussionValidationError("Anchor payload must be a JSON object.")

    if scope.scope_type == "theorem":
        document = scope.theorem_document
        if document is None:
            raise DiscussionNotFoundError("Discussion scope not found.")
        if normalized_type == "general":
            return {}
        if normalized_type == "lean_decl":
            symbol_name = str(payload.get("symbol_name") or "").strip()
            declaration_kind = str(payload.get("declaration_kind") or "").strip()
            start_line = int(payload.get("start_line") or 0)
            end_line = int(payload.get("end_line") or 0)
            if not symbol_name or not declaration_kind or start_line <= 0 or end_line < start_line:
                raise DiscussionValidationError("Lean declaration anchors require symbol and line range.")
            return {
                "document_id": document.id,
                "symbol_name": symbol_name,
                "declaration_kind": declaration_kind,
                "start_line": start_line,
                "end_line": end_line,
                "document_sha256": document.sha256,
            }
        if normalized_type == "pdf_page":
            pdf_page = int(payload.get("pdf_page") or 0)
            if pdf_page <= 0:
                raise DiscussionValidationError("PDF page anchors require a valid page number.")
            if scope.theorem_workspace is None or not scope.theorem_workspace.pdf_path:
                raise DiscussionValidationError("This theorem does not have a PDF to annotate.")
            normalized_payload = {
                "document_id": document.id,
                "pdf_page": pdf_page,
                "document_sha256": document.sha256,
            }
            pdf_excerpt = str(payload.get("pdf_excerpt") or "").strip()
            if pdf_excerpt:
                normalized_payload["pdf_excerpt"] = pdf_excerpt[:1200]
            symbol_name = str(payload.get("symbol_name") or "").strip()
            declaration_kind = str(payload.get("declaration_kind") or "").strip()
            start_line = int(payload.get("start_line") or 0)
            end_line = int(payload.get("end_line") or 0)
            if symbol_name and declaration_kind and start_line > 0 and end_line >= start_line:
                normalized_payload["symbol_name"] = symbol_name
                normalized_payload["declaration_kind"] = declaration_kind
                normalized_payload["start_line"] = start_line
                normalized_payload["end_line"] = end_line
            return normalized_payload
        raise DiscussionValidationError("Unsupported anchor type for theorem discussions.")

    if normalized_type == "general":
        return {}
    if normalized_type != "project_readme":
        raise DiscussionValidationError("Unsupported anchor type for project discussions.")
    if not scope.project_root or not scope.readme_path:
        raise DiscussionNotFoundError("Discussion scope not found.")
    return {
        "project_root": scope.project_root,
        "readme_path": scope.readme_path,
        "readme_sha256": sha256_text(scope.readme_content or ""),
    }
