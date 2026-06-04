import re
import json
import uuid
import glob
import shutil
from typing import Any
from pathlib import Path, PurePosixPath
from fastapi import HTTPException, UploadFile

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

def unique_import_data_directory(name: str) -> Path:
    stem = safe_project_stem(name)
    target = IMAGE_ROOT / stem
    index = 2
    while target.exists():
        target = IMAGE_ROOT / f"{stem}_{index}"
        index += 1
    return target

def uploaded_relative_parts(filename: str) -> tuple[str, ...]:
    parts = PurePosixPath(filename.replace("\\", "/")).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(status_code=400, detail=f"Invalid uploaded path: {filename}")
    return tuple(parts)

async def import_data_directory(files: list[UploadFile]) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="Please select a data directory")

    uploaded_paths = [(file, uploaded_relative_parts(file.filename or "")) for file in files]
    root_names = {parts[0] for _, parts in uploaded_paths}
    if len(root_names) != 1:
        raise HTTPException(status_code=400, detail="Please import one directory at a time")

    target_directory = unique_import_data_directory(next(iter(root_names)))
    file_count = 0
    for upload, parts in uploaded_paths:
        relative_parts = parts[1:] or parts
        target_path = (target_directory / Path(*relative_parts)).resolve()
        try:
            target_path.relative_to(target_directory.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid uploaded path: {upload.filename}") from exc

        target_path.parent.mkdir(parents=True, exist_ok=True)
        with target_path.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                output.write(chunk)
        file_count += 1

    return {
        "directory": str(target_directory),
        "file_count": file_count,
    }

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

def has_glob_pattern(path: str) -> bool:
    return any(character in path for character in "*?[")


def resolve_directory_pattern(raw_directory: str, label: str) -> str:
    directory = Path(raw_directory)
    if not directory.is_absolute():
        directory = IMAGE_ROOT / directory
    directory_text = str(directory)
    parts = directory.parts
    first_glob_part = next(
        (index for index, part in enumerate(parts) if has_glob_pattern(part)),
        len(parts),
    )
    fixed_prefix = Path(*parts[:first_glob_part]) if first_glob_part else Path(directory.anchor)
    fixed_prefix = fixed_prefix.resolve()
    try:
        fixed_prefix.relative_to(IMAGE_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{label} directory must be inside mounted image root: {IMAGE_ROOT}",
        ) from exc

    if not has_glob_pattern(directory_text):
        resolved = directory.resolve()
        try:
            resolved.relative_to(IMAGE_ROOT)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"{label} directory must be inside mounted image root: {IMAGE_ROOT}",
            ) from exc
        if label == "Image" and (not resolved.exists() or not resolved.is_dir()):
            raise HTTPException(status_code=400, detail=f"Image directory not found: {resolved}")
        return str(resolved)

    return directory_text


def resolve_image_directory(raw_directory: str) -> str:
    return resolve_directory_pattern(raw_directory, "Image")


def resolve_mask_directory(raw_directory: str) -> str:
    directory_text = resolve_directory_pattern(raw_directory, "Mask")
    if has_glob_pattern(directory_text):
        return directory_text
    directory = Path(directory_text)
    directory.mkdir(parents=True, exist_ok=True)
    return str(directory)


def expand_directory_pattern(directory_pattern: str) -> list[Path]:
    if has_glob_pattern(directory_pattern):
        directories = [
            Path(match).resolve()
            for match in glob.glob(directory_pattern)
            if Path(match).is_dir()
        ]
    else:
        directory = Path(directory_pattern).resolve()
        directories = [directory] if directory.is_dir() else []

    unique_directories = []
    seen = set()
    for directory in directories:
        try:
            directory.relative_to(IMAGE_ROOT)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Matched directory is outside mounted image root: {directory}",
            ) from exc
        key = str(directory)
        if key not in seen:
            seen.add(key)
            unique_directories.append(directory)
    return sorted(unique_directories, key=str)


def normalize_mask_labels(raw_labels: Any) -> list[dict[str, Any]]:
    if not raw_labels:
        return []
    labels = []
    seen_names: set[str] = set()
    for raw_label in raw_labels:
        if hasattr(raw_label, "model_dump"):
            raw_label = raw_label.model_dump()
        if not isinstance(raw_label, dict):
            continue
        name = str(raw_label.get("name", "")).strip()
        directory = str(raw_label.get("directory", "")).strip()
        color = str(raw_label.get("color", "#ff3b8f")).strip()
        opacity = raw_label.get("opacity", 0.55)
        if not name or not directory or name in seen_names:
            continue
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
            color = "#ff3b8f"
        try:
            opacity = max(0.05, min(float(opacity), 1.0))
        except (TypeError, ValueError):
            opacity = 0.55
        seen_names.add(name)
        labels.append({
            "name": name,
            "directory": resolve_mask_directory(directory),
            "color": color,
            "opacity": opacity,
        })
    return labels


def find_mask_label(project: dict[str, Any], mask_name: str) -> dict[str, str]:
    label = next((item for item in project.get("mask_labels", []) if item["name"] == mask_name), None)
    if label is None:
        raise HTTPException(status_code=404, detail="Mask label not found")
    return label


def wildcard_regex_from_pattern(directory_pattern: str) -> re.Pattern[str]:
    escaped = ""
    wildcard_index = 0
    for character in directory_pattern:
        if character == "*":
            escaped += f"(?P<wildcard_{wildcard_index}>[^/\\\\]+)"
            wildcard_index += 1
        else:
            escaped += re.escape(character)
    return re.compile(f"^{escaped}$", re.IGNORECASE)


def apply_wildcards_to_pattern(directory_pattern: str, wildcards: dict[str, str]) -> str:
    if directory_pattern.count("*") != len(wildcards):
        return directory_pattern.replace("*", "_")
    output = directory_pattern
    for index in range(len(wildcards)):
        output = output.replace("*", wildcards[f"wildcard_{index}"], 1)
    return output


def mask_directory_for_image(image_path: str, image_directory_pattern: str, mask_directory_pattern: str) -> Path:
    if has_glob_pattern(mask_directory_pattern):
        if has_glob_pattern(image_directory_pattern):
            image_parent = str(Path(image_path).parent)
            match = wildcard_regex_from_pattern(image_directory_pattern).match(image_parent)
            if match:
                directory = Path(apply_wildcards_to_pattern(mask_directory_pattern, match.groupdict())).resolve()
            else:
                directory = Path(mask_directory_pattern.replace("*", "_")).resolve()
        else:
            directory = Path(mask_directory_pattern.replace("*", "_")).resolve()
    else:
        directory = Path(mask_directory_pattern).resolve()

    try:
        directory.relative_to(IMAGE_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Mask directory is outside mounted image root: {directory}") from exc
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def mask_path_for_image(image_path: str, mask_label: dict[str, str], image_directory_pattern: str) -> Path:
    image_name = Path(image_path).stem
    return mask_directory_for_image(image_path, image_directory_pattern, mask_label["directory"]) / f"{image_name}.png"


def find_project(project_id: str) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    meta = load_project_meta()
    meta_item = next((item for item in meta if item["id"] == project_id), None)
    if meta_item is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return meta, meta_item, load_project(meta_item)

def delete_project_image(project_id: str, image_id: str, delete_file: bool) -> dict[str, Any]:
    meta, _, project = find_project(project_id)
    image = next((item for item in project["images"] if item["id"] == image_id), None)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    if delete_file:
        image_path = Path(image["path"]).resolve()
        try:
            image_path.relative_to(IMAGE_ROOT)
        except ValueError as exc:
            raise HTTPException(status_code=403, detail="Image path is outside mounted image root") from exc
        if image_path.exists():
            if not image_path.is_file():
                raise HTTPException(status_code=400, detail="Image path is not a file")
            image_path.unlink()

    project["images"] = [item for item in project["images"] if item["id"] != image_id]
    project["updated_at"] = now_iso()
    save_project(project, meta)
    return project

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
        "mask_labels": normalize_mask_labels(raw_project.get("mask_labels", [])),
        "image_directory": str(raw_project.get("image_directory", "")),
        "images": imported_images,
        "created_at": str(raw_project.get("created_at") or timestamp),
        "updated_at": timestamp,
    }


def scan_image_paths(directory_pattern: str) -> list[str]:
    directories = expand_directory_pattern(directory_pattern)
    if not directories:
        raise HTTPException(status_code=400, detail=f"No directories matched: {directory_pattern}")
    return sorted(
        str(path)
        for directory in directories
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

