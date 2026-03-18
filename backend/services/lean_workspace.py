from __future__ import annotations

import asyncio
import base64
import hashlib
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx

from config import Settings


class LeanWorkspaceError(RuntimeError):
    pass


def _split_configured_playground_path(settings: Settings) -> tuple[Path, str]:
    configured_path = Path(settings.lean_playground_file)
    parent = configured_path.parent
    fallback_stem = configured_path.stem or "Playground"
    return parent, fallback_stem


def _title_to_lean_stem(title: str, fallback_stem: str) -> str:
    normalized_title = title.strip()
    parts = re.findall(r"[A-Za-z0-9]+", normalized_title)
    if parts:
        stem = "".join(part[:1].upper() + part[1:] for part in parts)
        if stem[0].isdigit():
            stem = f"Doc{stem}"
        return stem

    if normalized_title:
        digest = hashlib.sha1(normalized_title.encode("utf-8")).hexdigest()[:8]
        return f"Document{digest}"

    return fallback_stem


def resolve_workspace_target(settings: Settings, title: str | None = None) -> dict[str, str]:
    parent, fallback_stem = _split_configured_playground_path(settings)
    stem = _title_to_lean_stem(title or "", fallback_stem)
    relative_path = (parent / f"{stem}.lean").as_posix() if str(parent) != "." else f"{stem}.lean"
    return {
        "path": relative_path,
        "module": _path_to_module(relative_path),
    }


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
    title: str | None = None,
    relative_path: str | None = None,
) -> dict[str, str]:
    resolved_target = (
        {"path": relative_path, "module": _path_to_module(relative_path)}
        if relative_path
        else resolve_workspace_target(settings, title)
    )
    target_path = _resolve_workspace_file(settings, resolved_target["path"])
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(code, encoding="utf-8")
    except OSError as exc:
        raise LeanWorkspaceError(
            "Failed to write the Lean workspace file. Check that the workspace mount exists and that backend/lean-server containers run with your host UID/GID."
        ) from exc

    relative = target_path.relative_to(settings.lean_workspace_dir).as_posix()
    return {
        "path": relative,
        "module": resolved_target["module"],
    }


def _remove_empty_parent_dirs(path: Path, *, stop_at: Path) -> None:
    current = path.parent
    while current != stop_at and stop_at in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def delete_workspace_file(
    settings: Settings,
    *,
    relative_path: str | None,
) -> None:
    if not relative_path:
        return

    target_path = _resolve_workspace_file(settings, relative_path)
    workspace_root = settings.lean_workspace_dir.resolve()

    if target_path.exists():
        target_path.unlink()
        _remove_empty_parent_dirs(target_path, stop_at=workspace_root)

    build_root = (workspace_root / ".lake" / "build" / "lib" / "lean").resolve()
    relative_prefix = Path(relative_path).with_suffix("")
    artifact_targets = [
        build_root / relative_prefix.with_suffix(".olean"),
        build_root / relative_prefix.with_suffix(".ilean"),
        build_root / relative_prefix.with_suffix(".trace"),
        build_root / relative_prefix.with_suffix(".olean.hash"),
        build_root / relative_prefix.with_suffix(".ilean.hash"),
    ]

    for artifact in artifact_targets:
        if artifact.exists():
            artifact.unlink()
            _remove_empty_parent_dirs(artifact, stop_at=build_root)


def get_workspace_info(settings: Settings, title: str | None = None) -> dict[str, object]:
    playground_target = (
        resolve_workspace_target(settings, title)
        if title is not None
        else {
            "path": settings.lean_playground_file,
            "module": _path_to_module(settings.lean_playground_file),
        }
    )
    return {
        "workspace_dir": str(settings.lean_workspace_dir),
        "playground_file": playground_target["path"],
        "playground_module": playground_target["module"],
        "repository_subdir": settings.lean_repository_subdir,
        "repository_url": settings.github_repository_url or None,
        "repository_branch": settings.github_repository_branch,
        "can_push": bool(settings.github_repository_url and settings.github_access_token),
        "importable_modules": list_importable_modules(settings),
    }


async def build_workspace_module(
    settings: Settings,
    *,
    relative_workspace_path: str,
    module_name: str,
    project_root: str | None = None,
) -> dict[str, object]:
    if not settings.lean_server_api_url:
        return {}

    endpoint = f"{settings.lean_server_api_url}/build-module"
    payload = {
        "path": relative_workspace_path,
        "module": module_name,
    }
    if project_root:
        payload["project_root"] = project_root

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(endpoint, json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.strip() or str(exc)
            raise LeanWorkspaceError(f"Lean module build failed: {detail}") from exc
        except httpx.HTTPError as exc:
            raise LeanWorkspaceError(f"Lean server build request failed: {exc}") from exc

    return response.json()


def build_workspace_module_sync(
    settings: Settings,
    *,
    relative_workspace_path: str,
    module_name: str,
    project_root: str | None = None,
) -> dict[str, object]:
    return asyncio.run(
        build_workspace_module(
            settings,
            relative_workspace_path=relative_workspace_path,
            module_name=module_name,
            project_root=project_root,
        )
    )


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

    owner, repo = match.group(1), match.group(2)
    if (owner, repo) in {
        ("owner", "repository"),
        ("your-org", "your-repo"),
        ("your-user", "your-repo"),
    }:
        raise LeanWorkspaceError(
            "GITHUB_REPOSITORY_URL is still set to a placeholder value. Update .env with your real GitHub repository URL."
        )

    return owner, repo


async def _ensure_github_repository_access(
    client: httpx.AsyncClient,
    *,
    owner: str,
    repo: str,
    branch: str,
    headers: dict[str, str],
) -> None:
    repo_response = await client.get(
        f"https://api.github.com/repos/{owner}/{repo}",
        headers=headers,
    )
    if repo_response.status_code == 404:
        raise LeanWorkspaceError(
            "GitHub repository was not found. Check GITHUB_REPOSITORY_URL and confirm that GITHUB_ACCESS_TOKEN can access that repository."
        )
    if repo_response.status_code >= 400:
        raise LeanWorkspaceError(
            f"GitHub repository lookup failed: {repo_response.text.strip()}"
        )

    branch_response = await client.get(
        f"https://api.github.com/repos/{owner}/{repo}/branches/{branch}",
        headers=headers,
    )
    if branch_response.status_code == 404:
        raise LeanWorkspaceError(
            f"GitHub branch `{branch}` was not found in {owner}/{repo}. Check GITHUB_REPOSITORY_BRANCH."
        )
    if branch_response.status_code >= 400:
        raise LeanWorkspaceError(
            f"GitHub branch lookup failed: {branch_response.text.strip()}"
        )


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
        await _ensure_github_repository_access(
            client,
            owner=owner,
            repo=repo,
            branch=settings.github_repository_branch,
            headers=headers,
        )

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
