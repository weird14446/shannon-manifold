from __future__ import annotations

import base64
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx

from config import Settings


class LeanWorkspaceError(RuntimeError):
    pass


def _resolve_workspace_file(settings: Settings, relative_path: str | None = None) -> Path:
    target = (relative_path or settings.lean_playground_file).strip().lstrip("/")
    candidate = (settings.lean_workspace_dir / target).resolve()
    workspace_root = settings.lean_workspace_dir.resolve()

    if workspace_root not in candidate.parents and candidate != workspace_root:
        raise LeanWorkspaceError("Lean workspace path must stay inside the configured workspace.")

    return candidate


def _path_to_module(path: str) -> str:
    parts = Path(path).with_suffix("").parts
    return ".".join(parts)


def list_importable_modules(settings: Settings) -> list[dict[str, str]]:
    modules: list[dict[str, str]] = []
    workspace_root = settings.lean_workspace_dir
    if not workspace_root.exists():
        return modules

    for lean_file in sorted(workspace_root.rglob("*.lean")):
        if any(part in {".lake", ".lean", "build"} for part in lean_file.parts):
            continue

        relative_path = lean_file.relative_to(workspace_root).as_posix()
        if relative_path == "lakefile.lean":
            continue

        modules.append(
            {
                "path": relative_path,
                "module": _path_to_module(relative_path),
            }
        )

    return modules


def write_workspace_file(
    settings: Settings,
    *,
    code: str,
    relative_path: str | None = None,
) -> dict[str, str]:
    target_path = _resolve_workspace_file(settings, relative_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(code, encoding="utf-8")

    relative = target_path.relative_to(settings.lean_workspace_dir).as_posix()
    return {
        "path": relative,
        "module": _path_to_module(relative),
    }


def get_workspace_info(settings: Settings) -> dict[str, object]:
    playground_relative_path = settings.lean_playground_file
    return {
        "workspace_dir": str(settings.lean_workspace_dir),
        "playground_file": playground_relative_path,
        "playground_module": _path_to_module(playground_relative_path),
        "repository_subdir": settings.lean_repository_subdir,
        "repository_url": settings.github_repository_url or None,
        "repository_branch": settings.github_repository_branch,
        "can_push": bool(settings.github_repository_url and settings.github_access_token),
        "importable_modules": list_importable_modules(settings),
    }


def _parse_github_repository(url: str) -> tuple[str, str]:
    if not url:
        raise LeanWorkspaceError("GITHUB_REPOSITORY_URL is not configured.")

    parsed = urlparse(url)
    if parsed.netloc not in {"github.com", "www.github.com"}:
        raise LeanWorkspaceError("Only github.com repository URLs are supported.")

    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]

    match = re.fullmatch(r"([^/]+)/([^/]+)", path)
    if not match:
        raise LeanWorkspaceError("GITHUB_REPOSITORY_URL must point to a repository root.")

    return match.group(1), match.group(2)


async def push_workspace_file_to_github(
    settings: Settings,
    *,
    relative_workspace_path: str,
    code: str,
    commit_message: str,
) -> dict[str, str | None]:
    if not settings.github_access_token:
        raise LeanWorkspaceError("GITHUB_ACCESS_TOKEN is not configured.")

    owner, repo = _parse_github_repository(settings.github_repository_url)
    repository_path = Path(settings.lean_repository_subdir, relative_workspace_path).as_posix()
    api_base = f"https://api.github.com/repos/{owner}/{repo}/contents/{repository_path}"
    headers = {
        "Authorization": f"Bearer {settings.github_access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    sha: str | None = None

    async with httpx.AsyncClient(timeout=45.0) as client:
        metadata_response = await client.get(
            api_base,
            headers=headers,
            params={"ref": settings.github_repository_branch},
        )
        if metadata_response.status_code == 200:
            sha = metadata_response.json().get("sha")
        elif metadata_response.status_code != 404:
            raise LeanWorkspaceError(
                f"GitHub metadata request failed: {metadata_response.text.strip()}"
            )

        payload: dict[str, object] = {
            "message": commit_message,
            "content": base64.b64encode(code.encode("utf-8")).decode("ascii"),
            "branch": settings.github_repository_branch,
            "committer": {
                "name": settings.github_commit_author_name,
                "email": settings.github_commit_author_email,
            },
        }
        if sha:
            payload["sha"] = sha

        push_response = await client.put(api_base, headers=headers, json=payload)
        if push_response.status_code not in {200, 201}:
            raise LeanWorkspaceError(
                f"GitHub push failed: {push_response.text.strip()}"
            )

        response_data = push_response.json()

    content_url = response_data.get("content", {}).get("html_url")
    commit_url = response_data.get("commit", {}).get("html_url")
    return {
        "repository_path": repository_path,
        "content_url": content_url,
        "commit_url": commit_url,
    }
