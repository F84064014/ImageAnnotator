import io
import csv
import uuid
import json
from typing import Any
from fastapi import (
    APIRouter, HTTPException,
    UploadFile, File
)
from fastapi.responses import (
    FileResponse, StreamingResponse
)
from app.schemas import (
    AnnotationUpdate, ProjectCreate, ProjectSettingsUpdate
)
from app.utils import now_iso
from app.services.project_service import (
    load_project, load_project_meta,
    save_project, save_project_meta,
    resolve_image_directory, resolve_image_path,
    scan_image_paths,
    unique_project_filename,
    atomic_write_json,
    project_summary, find_project,
    prepare_imported_project,
    normalize_attribute_value,
    has_selected_attribute, validate_attribute_value,
    project_file_from_meta
)
from app.services.model_service   import (
    require_model, predict_image_attributes
)
from app.config import (
    PROJECTS_DIR
)

router = APIRouter()

@router.get("/projects")
def list_projects() -> list[dict[str, Any]]:
    return [{key: value for key, value in project.items() if key != "file"} for project in load_project_meta()]


@router.post("/projects", status_code=201)
def create_project(payload: ProjectCreate) -> dict[str, Any]:
    meta = load_project_meta()
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")

    attributes = list(dict.fromkeys(attr.strip() for attr in payload.attributes if attr.strip()))
    if not attributes:
        raise HTTPException(status_code=400, detail="At least one attribute is required")

    directory = resolve_image_directory(payload.image_directory)
    image_paths = scan_image_paths(directory)
    if not image_paths:
        raise HTTPException(status_code=400, detail="No supported image files found")

    timestamp = now_iso()
    project_id = str(uuid.uuid4())
    filename = unique_project_filename(name, {item.get("file", "") for item in meta})
    project = {
        "id": project_id,
        "name": name,
        "attributes": attributes,
        "image_directory": str(directory),
        "images": [
            {
                "id": str(uuid.uuid4()),
                "path": image_path,
                "attributes": {attribute: 0 for attribute in attributes},
                "annotated": False,
            }
            for image_path in image_paths
        ],
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    atomic_write_json(PROJECTS_DIR / filename, project)
    summary = project_summary(project)
    meta.append({**summary, "file": filename})
    save_project_meta(meta)
    return project_summary(project)


@router.post("/projects/import", status_code=201)
async def import_project(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Please upload a .json project file")

    try:
        raw_project = json.loads((await file.read()).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON file") from exc

    meta = load_project_meta()
    project = prepare_imported_project(raw_project, meta)
    filename = unique_project_filename(project["name"], {item.get("file", "") for item in meta})
    atomic_write_json(PROJECTS_DIR / filename, project)
    summary = project_summary(project)
    meta.append({**summary, "file": filename})
    save_project_meta(meta)
    return summary


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> None:
    meta = load_project_meta()
    meta_item = next((item for item in meta if item["id"] == project_id), None)
    if meta_item is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project_file = project_file_from_meta(meta_item)
    if project_file.exists():
        project_file.unlink()
    save_project_meta([project for project in meta if project["id"] != project_id])


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    _, _, project = find_project(project_id)
    return project


@router.put("/projects/{project_id}/settings")
def update_project_settings(project_id: str, payload: ProjectSettingsUpdate) -> dict[str, Any]:
    meta, _, project = find_project(project_id)
    directory = resolve_image_directory(payload.image_directory)
    attributes = list(dict.fromkeys(attribute.strip() for attribute in payload.attributes if attribute.strip()))
    if not attributes:
        raise HTTPException(status_code=400, detail="At least one attribute is required")

    project["image_directory"] = str(directory)
    project["attributes"] = attributes
    for image in project["images"]:
        current_attributes = image.get("attributes", {})
        image["attributes"] = {
            attribute: normalize_attribute_value(current_attributes.get(attribute, 0))
            for attribute in attributes
        }
    project["updated_at"] = now_iso()
    save_project(project, meta)
    return project


@router.post("/projects/{project_id}/scan")
def scan_project_images(project_id: str) -> dict[str, Any]:
    meta, _, project = find_project(project_id)
    directory = resolve_image_directory(project["image_directory"])
    image_paths = scan_image_paths(directory)
    if not image_paths:
        raise HTTPException(status_code=400, detail="No supported image files found")

    existing_by_path = {image["path"]: image for image in project["images"]}
    project["images"] = [
        existing_by_path.get(
            image_path,
            {
                "id": str(uuid.uuid4()),
                "path": image_path,
                "attributes": {attribute: 0 for attribute in project["attributes"]},
                "annotated": False,
            },
        )
        for image_path in image_paths
    ]
    project["updated_at"] = now_iso()
    save_project(project, meta)
    return project


@router.post("/projects/{project_id}/model/label-unannotated")
def label_unannotated_with_model(project_id: str) -> dict[str, Any]:
    _, config, _ = require_model()
    meta, _, project = find_project(project_id)
    mapped_attributes = set(config.attributes.keys()) & set(project["attributes"])
    if not mapped_attributes:
        raise HTTPException(status_code=400, detail="Loaded model has no attributes that match this project")

    labeled_count = 0
    for image in project["images"]:
        if image.get("annotated"):
            continue
        predictions = predict_image_attributes(resolve_image_path(image["path"]))
        next_attributes = {
            attribute: normalize_attribute_value(image.get("attributes", {}).get(attribute, 0))
            for attribute in project["attributes"]
        }
        for attribute in mapped_attributes:
            next_attributes[attribute] = predictions[attribute]
        image["attributes"] = next_attributes
        image["annotated"] = True
        image["annotation_source"] = "model"
        labeled_count += 1

    if labeled_count:
        project["updated_at"] = now_iso()
        save_project(project, meta)
    return {"project": project, "labeled_count": labeled_count}


@router.put("/projects/{project_id}/images/{image_id}/annotation")
def update_annotation(project_id: str, image_id: str, payload: AnnotationUpdate) -> dict[str, Any]:
    meta, _, project = find_project(project_id)
    image = next((item for item in project["images"] if item["id"] == image_id), None)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    image["attributes"] = {}
    for attribute in project["attributes"]:
        image["attributes"][attribute] = validate_attribute_value(payload.attributes.get(attribute, 2))
    if image.get("annotated") and image.get("annotation_source") in {"model", "model_modified"}:
        image["annotation_source"] = "model_modified"
    project["updated_at"] = now_iso()
    save_project(project, meta)
    return image


@router.put("/projects/{project_id}/images/{image_id}/annotated")
def mark_image_annotated(project_id: str, image_id: str) -> dict[str, Any]:
    meta, _, project = find_project(project_id)
    image = next((item for item in project["images"] if item["id"] == image_id), None)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    if has_selected_attribute(image, project["attributes"]):
        image["annotated"] = True
        image["annotation_source"] = "manual"
        project["updated_at"] = now_iso()
        save_project(project, meta)
    return image


@router.get("/projects/{project_id}/export")
def export_project(project_id: str) -> StreamingResponse:
    _, _, project = find_project(project_id)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["image_path", "annotated", *project["attributes"]])
    for image in project["images"]:
        writer.writerow(
            [
                image["path"],
                image.get("annotated", False),
                *(
                    normalize_attribute_value(image.get("attributes", {}).get(attribute, 2))
                    for attribute in project["attributes"]
                ),
            ]
        )
    buffer.seek(0)
    filename = f"{project['name'].replace(' ', '_')}_annotations.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.get("/image")
def get_image(path: str) -> FileResponse:
    return FileResponse(resolve_image_path(path), headers={"Cache-Control": "no-store"})
