from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from config import Settings
from services.lean_workspace import (
    LeanWorkspaceError,
    build_workspace_module,
)

PROJECTS_DIRNAME = "projects"
PROJECT_MANIFEST_FILENAME = ".shannon-project.json"
PROJECT_README_FILENAME = "README.md"
PACKAGE_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
PROJECT_VISIBILITIES = {"private", "public"}
PROJECT_VALIDATION_DIRNAME = "ShannonValidation"


def owner_slug_for_user(user_id: int) -> str:
    return f"user{user_id}"


def normalize_project_slug(title: str) -> str:
    parts = PACKAGE_TOKEN_RE.findall(title.strip().lower())
    if parts:
        return "-".join(parts)
    return "project"


def title_from_slug(slug: str) -> str:
    parts = [part for part in re.split(r"[-_]+", slug) if part]
    if not parts:
        return "Project"
    return " ".join(part[:1].upper() + part[1:] for part in parts)


def package_name_for_project(owner_slug: str, project_name: str) -> str:
    tokens = PACKAGE_TOKEN_RE.findall(f"{owner_slug} {project_name}")
    if not tokens:
        return "UserProject"

    package_name = "".join(token[:1].upper() + token[1:] for token in tokens)
    if package_name[0].isdigit():
        return f"Pkg{package_name}"
    return package_name


def canonical_project_root(owner_slug: str, project_slug: str) -> str:
    return f"{PROJECTS_DIRNAME}/{owner_slug}/{project_slug}"


def workspace_relative_project_file_path(project_root: str, relative_path: str) -> str:
    normalized_root = canonicalize_project_root(project_root)
    normalized_path = Path(relative_path.strip().replace("\\", "/")).as_posix().lstrip("/")
    return f"{normalized_root}/{normalized_path}"


def project_scope_from_workspace_path(path: str | None) -> dict[str, str] | None:
    if not path:
        return None

    normalized_path = Path(path.strip().replace("\\", "/")).as_posix().lstrip("/")
    parts = [part for part in normalized_path.split("/") if part]
    if len(parts) < 4 or parts[0] != PROJECTS_DIRNAME:
        return None

    owner_slug = parts[1]
    project_slug = parts[2]
    return {
        "owner_slug": owner_slug,
        "project_slug": project_slug,
        "project_root": canonical_project_root(owner_slug, project_slug),
    }


def _normalize_github_url(url: str | None) -> str | None:
    if url is None:
        return None

    cleaned = url.strip()
    if not cleaned:
        return None

    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or parsed.netloc not in {"github.com", "www.github.com"}:
        raise LeanWorkspaceError("GitHub link must point to a GitHub repository root.")

    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]

    match = re.fullmatch(r"([^/]+)/([^/]+)", path)
    if not match:
        raise LeanWorkspaceError("GitHub link must point to a GitHub repository root.")

    owner, repo = match.group(1), match.group(2)
    if (owner, repo) in {
        ("owner", "repository"),
        ("your-org", "your-repo"),
        ("your-user", "your-repo"),
    }:
        raise LeanWorkspaceError("Update the placeholder GitHub link to your real repository URL.")

    return f"https://github.com/{owner}/{repo}"


def normalize_project_visibility(value: str | None) -> str:
    normalized = (value or "private").strip().lower()
    if normalized not in PROJECT_VISIBILITIES:
        raise LeanWorkspaceError("Project visibility must be either public or private.")
    return normalized


def canonicalize_project_root(project_root: str) -> str:
    normalized = Path(project_root.strip().replace("\\", "/")).as_posix().lstrip("/")
    parts = [part for part in normalized.split("/") if part and part != "."]
    if any(part == ".." for part in parts):
        raise LeanWorkspaceError("Project root must stay inside the shared Lean workspace.")
    if not parts:
        raise LeanWorkspaceError("Project root is required.")
    if parts[0].lower() != PROJECTS_DIRNAME:
        raise LeanWorkspaceError("Project root must live under projects/.")
    parts[0] = PROJECTS_DIRNAME
    return "/".join(parts)


def _resolve_project_root(settings: Settings, project_root: str) -> Path:
    normalized_root = canonicalize_project_root(project_root)
    candidate = (settings.lean_workspace_dir / normalized_root).resolve()
    projects_root = (settings.lean_workspace_dir / PROJECTS_DIRNAME).resolve()
    workspace_root = settings.lean_workspace_dir.resolve()
    if workspace_root not in candidate.parents or projects_root not in candidate.parents:
        raise LeanWorkspaceError("Project root must stay inside projects/.")
    return candidate


def _project_manifest_path(settings: Settings, project_root: str) -> Path:
    return _resolve_project_root(settings, project_root) / PROJECT_MANIFEST_FILENAME


def _read_project_manifest(settings: Settings, project_root: str) -> dict[str, str]:
    manifest_path = _project_manifest_path(settings, project_root)
    if not manifest_path.exists():
        return {}

    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}

    if not isinstance(payload, dict):
        return {}

    return {str(key): str(value) for key, value in payload.items() if value is not None}


def _write_project_manifest(settings: Settings, project_root: str, payload: dict[str, str | None]) -> None:
    manifest_path = _project_manifest_path(settings, project_root)
    normalized_payload = {key: value for key, value in payload.items() if value is not None}
    manifest_path.write_text(
        json.dumps(normalized_payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _build_project_record(
    *,
    scaffold: dict[str, str],
    owner_slug: str,
    project_slug: str,
    title: str,
    github_url: str | None,
    visibility: str,
) -> dict[str, str | None]:
    return {
        "title": title,
        "slug": project_slug,
        "owner_slug": owner_slug,
        "project_root": scaffold["project_root"],
        "package_name": scaffold["package_name"],
        "entry_file_path": scaffold["entry_file_path"],
        "entry_module_name": scaffold["entry_module_name"],
        "github_url": github_url,
        "visibility": visibility,
    }


def _resolve_project_file(settings: Settings, project_root: str, relative_path: str) -> Path:
    normalized_path = Path(relative_path.strip().replace("\\", "/")).as_posix().lstrip("/")
    parts = [part for part in normalized_path.split("/") if part and part != "."]
    if any(part == ".." for part in parts):
        raise LeanWorkspaceError("Project file path must stay inside the project root.")
    if not parts or not parts[-1].endswith(".lean"):
        raise LeanWorkspaceError("Project file path must point to a .lean file.")

    project_root_path = _resolve_project_root(settings, project_root)
    candidate = (project_root_path / "/".join(parts)).resolve()
    if project_root_path not in candidate.parents:
        raise LeanWorkspaceError("Project file path must stay inside the project root.")
    return candidate


def _remove_empty_parent_dirs(path: Path, *, stop_at: Path) -> None:
    current = path.parent
    while current != stop_at and stop_at in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def _package_declaration_name(package_name: str) -> str:
    return package_name[:1].lower() + package_name[1:]


def project_lakefile_content(package_name: str) -> str:
    return (
        "import Lake\n"
        "open Lake DSL\n\n"
        f"package {_package_declaration_name(package_name)} where\n\n"
        f"lean_lib {package_name} where\n"
    )


def project_root_module_content(package_name: str) -> str:
    return f"import {package_name}.Main\n"


def project_entry_module_content(package_name: str) -> str:
    return (
        "/-\n"
        f"Auto-generated entry module for the {package_name} project.\n"
        "This file is created automatically so `import "
        f"{package_name}.Main` always resolves.\n"
        "-/\n\n"
        "abbrev mynat := Nat\n"
    )


def project_file_template(package_name: str) -> str:
    return (
        f"import {package_name}.Main\n\n"
        "-- Start writing Lean here.\n"
    )


def project_readme_content(
    *,
    title: str,
    owner_slug: str,
    project_slug: str,
    package_name: str,
    entry_module_name: str,
    visibility: str,
) -> str:
    return (
        f"# {title}\n\n"
        f"- Owner: `{owner_slug}`\n"
        f"- Project slug: `{project_slug}`\n"
        f"- Visibility: `{visibility}`\n"
        f"- Package: `{package_name}`\n"
        f"- Entry module: `{entry_module_name}`\n\n"
        "## Overview\n\n"
        "Describe the purpose of this Lean project here.\n\n"
        "## Importing\n\n"
        "Import the entry module from other files with:\n\n"
        f"```lean\nimport {entry_module_name}\n```\n"
    )


def ensure_project_scaffold(
    settings: Settings,
    *,
    project_root: str,
    package_name: str,
    readme_title: str | None = None,
    owner_slug: str | None = None,
    project_slug: str | None = None,
    visibility: str | None = None,
) -> dict[str, str]:
    normalized_root = canonicalize_project_root(project_root)
    project_root_path = _resolve_project_root(settings, normalized_root)
    project_root_path.mkdir(parents=True, exist_ok=True)

    root_module_path = project_root_path / f"{package_name}.lean"
    entry_module_relative = f"{package_name}/Main.lean"
    entry_module_path = project_root_path / entry_module_relative
    lakefile_path = project_root_path / "lakefile.lean"
    readme_path = project_root_path / PROJECT_README_FILENAME
    lean_toolchain_path = project_root_path / "lean-toolchain"
    workspace_toolchain_path = settings.lean_workspace_dir / "lean-toolchain"

    if not lakefile_path.exists():
        lakefile_path.write_text(project_lakefile_content(package_name), encoding="utf-8")
    if not root_module_path.exists():
        root_module_path.write_text(project_root_module_content(package_name), encoding="utf-8")
    if not entry_module_path.exists():
        entry_module_path.parent.mkdir(parents=True, exist_ok=True)
        entry_module_path.write_text(project_entry_module_content(package_name), encoding="utf-8")
    if (
        not readme_path.exists()
        and readme_title is not None
        and owner_slug is not None
        and project_slug is not None
        and visibility is not None
    ):
        readme_path.write_text(
            project_readme_content(
                title=readme_title,
                owner_slug=owner_slug,
                project_slug=project_slug,
                package_name=package_name,
                entry_module_name=f"{package_name}.Main",
                visibility=visibility,
            ),
            encoding="utf-8",
        )
    if workspace_toolchain_path.exists() and not lean_toolchain_path.exists():
        lean_toolchain_path.write_text(
            workspace_toolchain_path.read_text(encoding="utf-8"),
            encoding="utf-8",
        )

    return {
        "project_root": normalized_root,
        "package_name": package_name,
        "entry_file_path": entry_module_relative,
        "entry_module_name": f"{package_name}.Main",
    }


def ensure_project_metadata(
    settings: Settings,
    *,
    owner_slug: str,
    project_slug: str,
    title: str | None = None,
    github_url: str | None = None,
    visibility: str | None = None,
) -> dict[str, str | None]:
    manifest = _read_project_manifest(
        settings,
        canonical_project_root(owner_slug, project_slug),
    )
    next_title = (
        title.strip() if title is not None else str(manifest.get("title", "")).strip()
    ) or title_from_slug(project_slug)
    next_visibility = normalize_project_visibility(
        visibility if visibility is not None else manifest.get("visibility")
    )
    scaffold = ensure_project_scaffold(
        settings,
        project_root=canonical_project_root(owner_slug, project_slug),
        package_name=package_name_for_project(owner_slug, project_slug),
        readme_title=next_title,
        owner_slug=owner_slug,
        project_slug=project_slug,
        visibility=next_visibility,
    )
    next_github_url = _normalize_github_url(
        github_url if github_url is not None else manifest.get("github_url")
    )

    next_payload = {
        "title": next_title,
        "slug": project_slug,
        "owner_slug": owner_slug,
        "package_name": scaffold["package_name"],
        "github_url": next_github_url,
        "visibility": next_visibility,
    }
    if next_payload != manifest:
        _write_project_manifest(settings, scaffold["project_root"], next_payload)

    return _build_project_record(
        scaffold=scaffold,
        owner_slug=owner_slug,
        project_slug=project_slug,
        title=next_title,
        github_url=next_github_url,
        visibility=next_visibility,
    )


def backfill_existing_project_scaffolds(settings: Settings) -> int:
    projects_root = settings.lean_workspace_dir / PROJECTS_DIRNAME
    if not projects_root.exists():
        return 0

    updated_count = 0
    for owner_dir in sorted(candidate for candidate in projects_root.iterdir() if candidate.is_dir()):
        for project_dir in sorted(candidate for candidate in owner_dir.iterdir() if candidate.is_dir()):
            package_name = package_name_for_project(owner_dir.name, project_dir.name)
            entry_path = project_dir / package_name / "Main.lean"
            root_module_path = project_dir / f"{package_name}.lean"
            lakefile_path = project_dir / "lakefile.lean"
            manifest_path = project_dir / PROJECT_MANIFEST_FILENAME
            had_missing_scaffold = not all(
                candidate.exists() for candidate in (entry_path, root_module_path, lakefile_path)
            )
            had_missing_metadata = not manifest_path.exists()
            ensure_project_scaffold(
                settings,
                project_root=f"{PROJECTS_DIRNAME}/{owner_dir.name}/{project_dir.name}",
                package_name=package_name,
            )
            ensure_project_metadata(
                settings,
                owner_slug=owner_dir.name,
                project_slug=project_dir.name,
            )
            if had_missing_scaffold or had_missing_metadata:
                updated_count += 1

    return updated_count


def list_all_projects(settings: Settings) -> list[dict[str, str | None]]:
    projects_root = settings.lean_workspace_dir / PROJECTS_DIRNAME
    if not projects_root.exists():
        return []

    projects: list[dict[str, str | None]] = []
    for owner_dir in sorted(candidate for candidate in projects_root.iterdir() if candidate.is_dir()):
        for project_dir in sorted(candidate for candidate in owner_dir.iterdir() if candidate.is_dir()):
            projects.append(
                ensure_project_metadata(
                    settings,
                    owner_slug=owner_dir.name,
                    project_slug=project_dir.name,
                )
            )

    projects.sort(
        key=lambda project: (
            str(project.get("owner_slug", "")).lower(),
            str(project.get("title", "")).lower(),
            str(project.get("slug", "")).lower(),
        )
    )
    return projects


def list_accessible_projects(
    settings: Settings,
    *,
    requester_user_id: int | None,
) -> list[dict[str, str | None]]:
    projects_root = settings.lean_workspace_dir / PROJECTS_DIRNAME
    if not projects_root.exists():
        return []

    requester_owner_slug = (
        owner_slug_for_user(requester_user_id) if requester_user_id is not None else None
    )
    projects: list[dict[str, str | None]] = []
    for owner_dir in sorted(candidate for candidate in projects_root.iterdir() if candidate.is_dir()):
        for project_dir in sorted(candidate for candidate in owner_dir.iterdir() if candidate.is_dir()):
            project = ensure_project_metadata(
                settings,
                owner_slug=owner_dir.name,
                project_slug=project_dir.name,
            )
            is_owner = requester_owner_slug == owner_dir.name
            if is_owner or project.get("visibility") == "public":
                projects.append(project)

    projects.sort(
        key=lambda project: (
            0 if requester_owner_slug == project.get("owner_slug") else 1,
            str(project.get("title", "")).lower(),
            str(project.get("owner_slug", "")),
            str(project.get("slug", "")),
        )
    )
    return projects


def ensure_user_project(
    settings: Settings,
    *,
    user_id: int,
    title: str,
    slug: str | None = None,
    github_url: str | None = None,
    visibility: str | None = None,
) -> dict[str, str | None]:
    owner_slug = owner_slug_for_user(user_id)
    project_slug = normalize_project_slug(slug or title)
    return ensure_project_metadata(
        settings,
        owner_slug=owner_slug,
        project_slug=project_slug,
        title=title,
        github_url=github_url,
        visibility=visibility,
    )


def get_user_project(
    settings: Settings,
    *,
    user_id: int,
    project_slug: str,
) -> dict[str, str | None]:
    owner_slug = owner_slug_for_user(user_id)
    owner_root = settings.lean_workspace_dir / PROJECTS_DIRNAME / owner_slug
    if not owner_root.exists():
        raise LeanWorkspaceError("Project not found.")

    exact_match = owner_root / project_slug
    if exact_match.exists() and exact_match.is_dir():
        resolved_slug = exact_match.name
    else:
        lowered_slug = project_slug.lower()
        matches = [
            candidate.name
            for candidate in owner_root.iterdir()
            if candidate.is_dir() and candidate.name.lower() == lowered_slug
        ]
        if not matches:
            raise LeanWorkspaceError("Project not found.")
        resolved_slug = matches[0]

    return ensure_project_metadata(
        settings,
        owner_slug=owner_slug,
        project_slug=resolved_slug,
    )


def get_project_by_owner_slug(
    settings: Settings,
    *,
    owner_slug: str,
    project_slug: str,
) -> dict[str, str | None]:
    owner_root = settings.lean_workspace_dir / PROJECTS_DIRNAME / owner_slug
    if not owner_root.exists():
        raise LeanWorkspaceError("Project not found.")

    exact_match = owner_root / project_slug
    if exact_match.exists() and exact_match.is_dir():
        resolved_slug = exact_match.name
    else:
        lowered_slug = project_slug.lower()
        matches = [
            candidate.name
            for candidate in owner_root.iterdir()
            if candidate.is_dir() and candidate.name.lower() == lowered_slug
        ]
        if not matches:
            raise LeanWorkspaceError("Project not found.")
        resolved_slug = matches[0]

    return ensure_project_metadata(
        settings,
        owner_slug=owner_slug,
        project_slug=resolved_slug,
    )


def get_accessible_project(
    settings: Settings,
    *,
    requester_user_id: int | None,
    project_slug: str,
    owner_slug: str | None = None,
) -> dict[str, str | None]:
    requester_owner_slug = (
        owner_slug_for_user(requester_user_id) if requester_user_id is not None else None
    )
    projects_root = settings.lean_workspace_dir / PROJECTS_DIRNAME
    if not projects_root.exists():
        raise LeanWorkspaceError("Project not found.")

    candidate_owners: list[str] = []
    if owner_slug:
        candidate_owners = [owner_slug]
    elif requester_owner_slug is not None:
        candidate_owners.append(requester_owner_slug)
        candidate_owners.extend(
            owner_dir.name
            for owner_dir in sorted(candidate for candidate in projects_root.iterdir() if candidate.is_dir())
            if owner_dir.name != requester_owner_slug
        )
    else:
        candidate_owners = [
            owner_dir.name
            for owner_dir in sorted(candidate for candidate in projects_root.iterdir() if candidate.is_dir())
        ]

    lowered_slug = project_slug.lower()
    matching_projects: list[dict[str, str | None]] = []
    for candidate_owner_slug in candidate_owners:
        owner_root = projects_root / candidate_owner_slug
        if not owner_root.exists():
            continue
        for candidate in owner_root.iterdir():
            if not candidate.is_dir() or candidate.name.lower() != lowered_slug:
                continue
            project = ensure_project_metadata(
                settings,
                owner_slug=candidate_owner_slug,
                project_slug=candidate.name,
            )
            matching_projects.append(project)
            if owner_slug is not None or requester_owner_slug == candidate_owner_slug:
                break

    if not matching_projects:
        raise LeanWorkspaceError("Project not found.")

    if owner_slug is None and len(matching_projects) > 1:
        exact_owner_match = next(
            (
                project
                for project in matching_projects
                if requester_owner_slug is not None and project.get("owner_slug") == requester_owner_slug
            ),
            None,
        )
        if exact_owner_match is not None:
            matching_projects = [exact_owner_match]
        else:
            public_matches = [project for project in matching_projects if project.get("visibility") == "public"]
            if len(public_matches) == 1:
                matching_projects = public_matches
            else:
                raise LeanWorkspaceError("Project owner is required to open this project.")

    project = matching_projects[0]
    is_owner = requester_owner_slug == project.get("owner_slug")
    if not is_owner and project.get("visibility") != "public":
        raise LeanWorkspaceError("Project not found.")
    return project


def update_user_project(
    settings: Settings,
    *,
    user_id: int,
    project_slug: str,
    title: str | None = None,
    github_url: str | None = None,
    visibility: str | None = None,
    readme_content: str | None = None,
) -> dict[str, str | None]:
    project = get_user_project(
        settings,
        user_id=user_id,
        project_slug=project_slug,
    )
    updated_project = ensure_project_metadata(
        settings,
        owner_slug=str(project["owner_slug"]),
        project_slug=str(project["slug"]),
        title=title,
        github_url=github_url,
        visibility=visibility,
    )
    if readme_content is not None:
        write_project_readme(
            settings,
            project_root=str(updated_project["project_root"]),
            content=readme_content,
        )
    return updated_project


def delete_project(
    settings: Settings,
    *,
    owner_slug: str,
    project_slug: str,
) -> dict[str, str | None]:
    project = get_project_by_owner_slug(
        settings,
        owner_slug=owner_slug,
        project_slug=project_slug,
    )
    project_root_path = _resolve_project_root(settings, str(project["project_root"]))
    owner_root = project_root_path.parent

    try:
        shutil.rmtree(project_root_path)
    except OSError as exc:
        raise LeanWorkspaceError("Failed to delete the project workspace.") from exc

    try:
        owner_root.rmdir()
    except OSError:
        pass

    return project


def module_name_from_project_path(relative_path: str) -> str:
    return ".".join(Path(relative_path).with_suffix("").parts)


def delete_project_file(
    settings: Settings,
    *,
    project_root: str,
    relative_path: str,
) -> None:
    normalized_relative = Path(relative_path).as_posix().lstrip("/")
    file_path = _resolve_project_file(settings, project_root, normalized_relative)
    project_root_path = _resolve_project_root(settings, project_root)

    if file_path.exists():
        file_path.unlink()
        _remove_empty_parent_dirs(file_path, stop_at=project_root_path)

    build_root = (project_root_path / ".lake" / "build" / "lib" / "lean").resolve()
    relative_prefix = Path(normalized_relative).with_suffix("")
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


def _project_validation_relative_path(source_relative_path: str) -> str:
    normalized_relative = Path(source_relative_path.strip().replace("\\", "/")).as_posix().lstrip("/")
    parts = [part for part in normalized_relative.split("/") if part and part != "."]
    package_root = parts[0] if parts else PROJECT_VALIDATION_DIRNAME
    base_stem = Path(parts[-1]).stem if parts else "Workspace"
    stem_tokens = PACKAGE_TOKEN_RE.findall(base_stem)
    safe_stem = "".join(token[:1].upper() + token[1:] for token in stem_tokens) or "Workspace"
    if safe_stem[0].isdigit():
        safe_stem = f"Doc{safe_stem}"
    return f"{package_root}/{PROJECT_VALIDATION_DIRNAME}/{safe_stem}{uuid4().hex[:10]}.lean"


def read_project_file(
    settings: Settings,
    *,
    project_root: str,
    relative_path: str,
) -> str:
    file_path = _resolve_project_file(settings, project_root, relative_path)
    if not file_path.exists():
        raise LeanWorkspaceError("Project file not found.")
    return file_path.read_text(encoding="utf-8")


def list_project_modules(
    settings: Settings,
    *,
    project_root: str,
    entry_file_path: str | None = None,
) -> list[dict[str, str | int | bool]]:
    project_root_path = _resolve_project_root(settings, project_root)
    entry_relative_path = Path(entry_file_path).as_posix().lstrip("/") if entry_file_path else None
    modules: list[dict[str, str | int | bool]] = []

    for lean_file in sorted(project_root_path.rglob("*.lean")):
        relative_path = lean_file.relative_to(project_root_path).as_posix()
        relative_parts = Path(relative_path).parts
        if any(part == ".lake" for part in relative_parts):
            continue
        if lean_file.name == "lakefile.lean":
            continue

        modules.append(
            {
                "path": relative_path,
                "module_name": module_name_from_project_path(relative_path),
                "title": lean_file.stem or title_from_slug(relative_path),
                "depth": max(len(relative_parts) - 1, 0),
                "is_entry": relative_path == entry_relative_path,
            }
        )

    modules.sort(
        key=lambda module: (
            0 if bool(module["is_entry"]) else 1,
            str(module["path"]).lower(),
        )
    )
    return modules


def read_project_readme(
    settings: Settings,
    *,
    project_root: str,
) -> tuple[str, str]:
    project_root_path = _resolve_project_root(settings, project_root)
    readme_path = (project_root_path / PROJECT_README_FILENAME).resolve()
    if project_root_path != readme_path.parent:
        raise LeanWorkspaceError("Project README path must stay inside the project root.")
    if not readme_path.exists():
        raise LeanWorkspaceError("Project README not found.")
    return PROJECT_README_FILENAME, readme_path.read_text(encoding="utf-8")


def write_project_readme(
    settings: Settings,
    *,
    project_root: str,
    content: str,
) -> tuple[str, str]:
    project_root_path = _resolve_project_root(settings, project_root)
    readme_path = (project_root_path / PROJECT_README_FILENAME).resolve()
    if project_root_path != readme_path.parent:
        raise LeanWorkspaceError("Project README path must stay inside the project root.")
    readme_path.write_text(content, encoding="utf-8")
    return PROJECT_README_FILENAME, content


def write_project_file(
    settings: Settings,
    *,
    project_root: str,
    relative_path: str,
    content: str,
) -> dict[str, str]:
    file_path = _resolve_project_file(settings, project_root, relative_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    return {
        "workspace_file_path": Path(relative_path).as_posix().lstrip("/"),
        "workspace_module_name": module_name_from_project_path(relative_path),
    }


def create_project_file(
    settings: Settings,
    *,
    project_root: str,
    package_name: str,
    relative_path: str,
) -> dict[str, str]:
    file_path = _resolve_project_file(settings, project_root, relative_path)
    normalized_relative = Path(relative_path).as_posix().lstrip("/")
    if not file_path.exists():
        template = (
            project_entry_module_content(package_name)
            if normalized_relative == f"{package_name}/Main.lean"
            else project_file_template(package_name)
        )
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(template, encoding="utf-8")

    return {
        "workspace_file_path": normalized_relative,
        "workspace_module_name": module_name_from_project_path(normalized_relative),
        "content": file_path.read_text(encoding="utf-8"),
    }


async def save_project_file(
    settings: Settings,
    *,
    project_root: str,
    relative_path: str,
    content: str,
) -> dict[str, str]:
    saved_file = write_project_file(
        settings,
        project_root=project_root,
        relative_path=relative_path,
        content=content,
    )
    await build_workspace_module(
        settings,
        relative_workspace_path=saved_file["workspace_file_path"],
        module_name=saved_file["workspace_module_name"],
        project_root=project_root,
    )
    return saved_file


async def validate_project_context_copy(
    settings: Settings,
    *,
    project_root: str,
    source_relative_path: str,
    content: str,
) -> dict[str, str]:
    validation_path = _project_validation_relative_path(source_relative_path)
    temp_file = write_project_file(
        settings,
        project_root=project_root,
        relative_path=validation_path,
        content=content,
    )
    try:
        await build_workspace_module(
            settings,
            relative_workspace_path=temp_file["workspace_file_path"],
            module_name=temp_file["workspace_module_name"],
            project_root=project_root,
        )
    finally:
        delete_project_file(
            settings,
            project_root=project_root,
            relative_path=validation_path,
        )

    return temp_file
