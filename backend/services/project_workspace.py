from __future__ import annotations

import re
from pathlib import Path

from config import Settings
from services.lean_workspace import (
    LeanWorkspaceError,
    build_workspace_module,
)

PROJECTS_DIRNAME = "projects"
PACKAGE_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


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


def ensure_project_scaffold(
    settings: Settings,
    *,
    project_root: str,
    package_name: str,
) -> dict[str, str]:
    normalized_root = canonicalize_project_root(project_root)
    project_root_path = _resolve_project_root(settings, normalized_root)
    project_root_path.mkdir(parents=True, exist_ok=True)

    root_module_path = project_root_path / f"{package_name}.lean"
    entry_module_relative = f"{package_name}/Main.lean"
    entry_module_path = project_root_path / entry_module_relative
    lakefile_path = project_root_path / "lakefile.lean"
    lean_toolchain_path = project_root_path / "lean-toolchain"
    workspace_toolchain_path = settings.lean_workspace_dir / "lean-toolchain"

    if not lakefile_path.exists():
        lakefile_path.write_text(project_lakefile_content(package_name), encoding="utf-8")
    if not root_module_path.exists():
        root_module_path.write_text(project_root_module_content(package_name), encoding="utf-8")
    if not entry_module_path.exists():
        entry_module_path.parent.mkdir(parents=True, exist_ok=True)
        entry_module_path.write_text(project_entry_module_content(package_name), encoding="utf-8")
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
            had_missing_scaffold = not all(
                candidate.exists() for candidate in (entry_path, root_module_path, lakefile_path)
            )
            ensure_project_scaffold(
                settings,
                project_root=f"{PROJECTS_DIRNAME}/{owner_dir.name}/{project_dir.name}",
                package_name=package_name,
            )
            if had_missing_scaffold:
                updated_count += 1

    return updated_count


def list_user_projects(settings: Settings, *, user_id: int) -> list[dict[str, str]]:
    owner_slug = owner_slug_for_user(user_id)
    owner_root = settings.lean_workspace_dir / PROJECTS_DIRNAME / owner_slug
    if not owner_root.exists():
        return []

    projects: list[dict[str, str]] = []
    for project_dir in sorted(candidate for candidate in owner_root.iterdir() if candidate.is_dir()):
        package_name = package_name_for_project(owner_slug, project_dir.name)
        scaffold = ensure_project_scaffold(
            settings,
            project_root=f"{PROJECTS_DIRNAME}/{owner_slug}/{project_dir.name}",
            package_name=package_name,
        )
        projects.append(
            {
                "title": title_from_slug(project_dir.name),
                "slug": project_dir.name,
                "owner_slug": owner_slug,
                "project_root": scaffold["project_root"],
                "package_name": package_name,
                "entry_file_path": scaffold["entry_file_path"],
                "entry_module_name": scaffold["entry_module_name"],
            }
        )

    return projects


def ensure_user_project(
    settings: Settings,
    *,
    user_id: int,
    title: str,
    slug: str | None = None,
) -> dict[str, str]:
    owner_slug = owner_slug_for_user(user_id)
    project_slug = normalize_project_slug(slug or title)
    package_name = package_name_for_project(owner_slug, title or project_slug)
    scaffold = ensure_project_scaffold(
        settings,
        project_root=canonical_project_root(owner_slug, project_slug),
        package_name=package_name,
    )
    return {
        "title": title.strip() or title_from_slug(project_slug),
        "slug": project_slug,
        "owner_slug": owner_slug,
        **scaffold,
    }


def get_user_project(
    settings: Settings,
    *,
    user_id: int,
    project_slug: str,
) -> dict[str, str]:
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

    package_name = package_name_for_project(owner_slug, resolved_slug)
    scaffold = ensure_project_scaffold(
        settings,
        project_root=f"{PROJECTS_DIRNAME}/{owner_slug}/{resolved_slug}",
        package_name=package_name,
    )
    return {
        "title": title_from_slug(resolved_slug),
        "slug": resolved_slug,
        "owner_slug": owner_slug,
        **scaffold,
    }


def module_name_from_project_path(relative_path: str) -> str:
    return ".".join(Path(relative_path).with_suffix("").parts)


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
