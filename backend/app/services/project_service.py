import re
import json
import uuid
import shutil
from typing import Any
from pathlib import Path
from fastapi import HTTPException

from app.utils import (
    now_iso
)
from app.config import (
    PROJECTS_META_FILE, PROJECTS_DIR, LEGACY_PROJECTS_FILE,
    IMAGE_ROOT, IMAGE_EXTENSIONS
)

def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    shutil.move(tmp, path)

def load_project_meta() -> list[dict[str, Any]]:
    ensure_data_dir()
    return json.loads(PROJECTS_META_FILE.read_text(encoding="utf-8"))


def save_project_meta(meta: list[dict[str, Any]]) -> None:
    ensure_data_dir()
    atomic_write_json(PROJECTS_META_FILE, meta)


def load_project(meta_item: dict[str, Any]) -> dict[str, Any]:
    ensure_data_dir()
    return json.loads(project_file_from_meta(meta_item).read_text(encoding="utf-8"))


def save_project(project: dict[str, Any], meta: list[dict[str, Any]]) -> None:
    meta_item = next((item for item in meta if item["id"] == project["id"]), None)
    if meta_item is None:
        raise HTTPException(status_code=404, detail="Project not found")

    atomic_write_json(project_file_from_meta(meta_item), project)
    meta_item.update(project_summary(project))
    save_project_meta(meta)

def project_file_from_meta(meta_item: dict[str, Any]) -> Path:
    filename = meta_item.get("file")
    if not filename:
        filename = f"{safe_project_stem(meta_item.get('name', 'project'))}.json"
        meta_item["file"] = filename
    return PROJECTS_DIR / filename

def ensure_data_dir() -> None:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    if not PROJECTS_META_FILE.exists():
        if LEGACY_PROJECTS_FILE.exists():
            migrate_legacy_projects()
        else:
            atomic_write_json(PROJECTS_META_FILE, [])

def safe_project_stem(name: str) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", name.strip()).strip("._-")
    if not safe_name:
        safe_name = "project"
    return safe_name

def unique_project_filename(name: str, taken: set[str]) -> str:
    stem = safe_project_stem(name)
    filename = f"{stem}.json"
    index = 2
    while filename in taken or (PROJECTS_DIR / filename).exists():
        filename = f"{stem}_{index}.json"
        index += 1
    return filename

def migrate_legacy_projects() -> None:
    projects = json.loads(LEGACY_PROJECTS_FILE.read_text(encoding="utf-8"))
    meta = []
    taken: set[str] = set()
    for project in projects:
        filename = unique_project_filename(project["name"], taken)
        taken.add(filename)
        atomic_write_json(PROJECTS_DIR / filename, project)
        summary = project_summary(project)
        summary["file"] = filename
        meta.append(summary)
    atomic_write_json(PROJECTS_META_FILE, meta)

def project_summary(project: dict[str, Any]) -> dict[str, Any]:
    annotated = sum(1 for image in project["images"] if image.get("annotated"))
    return {
        "id": project["id"],
        "name": project["name"],
        "attributes": project["attributes"],
        "image_directory": project["image_directory"],
        "image_count": len(project["images"]),
        "annotated_count": annotated,
        "created_at": project["created_at"],
        "updated_at": project["updated_at"],
    }

def resolve_image_path(path: str) -> Path:
    image_path = Path(path).resolve()
    try:
        image_path.relative_to(IMAGE_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Image path is outside mounted image root") from exc

    if not image_path.exists() or not image_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image type")
    return image_path

def resolve_image_directory(raw_directory: str) -> Path:
    directory = Path(raw_directory)
    if not directory.is_absolute():
        directory = IMAGE_ROOT / directory
    directory = directory.resolve()

    try:
        directory.relative_to(IMAGE_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Image directory must be inside mounted image root: {IMAGE_ROOT}",
        ) from exc

    if not directory.exists() or not directory.is_dir():
        raise HTTPException(status_code=400, detail=f"Image directory not found: {directory}")

    return directory


def find_project(project_id: str) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    meta = load_project_meta()
    meta_item = next((item for item in meta if item["id"] == project_id), None)
    if meta_item is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return meta, meta_item, load_project(meta_item)

def prepare_imported_project(raw_project: Any, meta: list[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(raw_project, dict):
        raise HTTPException(status_code=400, detail="Project JSON must be an object")

    name = str(raw_project.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project JSON is missing a valid name")

    attributes = raw_project.get("attributes")
    if not isinstance(attributes, list):
        raise HTTPException(status_code=400, detail="Project JSON is missing attributes")
    attributes = list(dict.fromkeys(str(attribute).strip() for attribute in attributes if str(attribute).strip()))
    if not attributes:
        raise HTTPException(status_code=400, detail="Project JSON must contain at least one attribute")

    images = raw_project.get("images")
    if not isinstance(images, list):
        raise HTTPException(status_code=400, detail="Project JSON is missing images")

    existing_ids = {item["id"] for item in meta}
    project_id = str(raw_project.get("id") or uuid.uuid4())
    if project_id in existing_ids:
        project_id = str(uuid.uuid4())

    imported_images = []
    for raw_image in images:
        if not isinstance(raw_image, dict):
            continue
        image_path = str(raw_image.get("path", "")).strip()
        if not image_path:
            continue
        raw_attributes = raw_image.get("attributes", {})
        if not isinstance(raw_attributes, dict):
            raw_attributes = {}
        imported_images.append(
            {
                "id": str(raw_image.get("id") or uuid.uuid4()),
                "path": image_path,
                "attributes": {
                    attribute: normalize_attribute_value(raw_attributes.get(attribute, 2))
                    for attribute in attributes
                },
                "annotated": bool(raw_image.get("annotated", False)),
            }
        )

    if not imported_images:
        raise HTTPException(status_code=400, detail="Project JSON does not contain valid images")

    timestamp = now_iso()
    return {
        "id": project_id,
        "name": name,
        "attributes": attributes,
        "image_directory": str(raw_project.get("image_directory", "")),
        "images": imported_images,
        "created_at": str(raw_project.get("created_at") or timestamp),
        "updated_at": timestamp,
    }


def scan_image_paths(directory: Path) -> list[str]:
    return sorted(
        str(path)
        for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )

def normalize_attribute_value(value: Any) -> int:
    if value is True:
        return 1
    if value is False:
        return 0
    if value in {0, 1, 2}:
        return int(value)
    return 2


def validate_attribute_value(value: Any) -> int:
    if value in {0, 1, 2}:
        return int(value)
    raise HTTPException(status_code=400, detail="Attribute values must be 0, 1, or 2")


def has_selected_attribute(image: dict[str, Any], attributes: list[str]) -> bool:
    image_attributes = image.get("attributes", {})
    return any(normalize_attribute_value(image_attributes.get(attribute, 0)) != 0 for attribute in attributes)

