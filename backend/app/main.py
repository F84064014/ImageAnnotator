import csv
import io
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field


DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
IMAGE_ROOT = Path(os.getenv("IMAGE_ROOT", "/images")).resolve()
PROJECTS_FILE = DATA_DIR / "projects.json"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"}


app = FastAPI(title="Image Annotator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    attributes: list[str] = Field(min_length=1)
    image_directory: str = Field(min_length=1)


class AnnotationUpdate(BaseModel):
    attributes: dict[str, int]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PROJECTS_FILE.exists():
        PROJECTS_FILE.write_text("[]", encoding="utf-8")


def load_projects() -> list[dict[str, Any]]:
    ensure_data_dir()
    import json

    return json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))


def save_projects(projects: list[dict[str, Any]]) -> None:
    ensure_data_dir()
    import json

    tmp = PROJECTS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(projects, indent=2, ensure_ascii=False), encoding="utf-8")
    shutil.move(tmp, PROJECTS_FILE)


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


def find_project(project_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    projects = load_projects()
    project = next((item for item in projects if item["id"] == project_id), None)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return projects, project


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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/projects")
def list_projects() -> list[dict[str, Any]]:
    return [project_summary(project) for project in load_projects()]


@app.post("/projects", status_code=201)
def create_project(payload: ProjectCreate) -> dict[str, Any]:
    projects = load_projects()
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")

    attributes = list(dict.fromkeys(attr.strip() for attr in payload.attributes if attr.strip()))
    if not attributes:
        raise HTTPException(status_code=400, detail="At least one attribute is required")

    directory = resolve_image_directory(payload.image_directory)
    image_paths = sorted(
        str(path)
        for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not image_paths:
        raise HTTPException(status_code=400, detail="No supported image files found")

    timestamp = now_iso()
    project = {
        "id": str(uuid.uuid4()),
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
    projects.append(project)
    save_projects(projects)
    return project_summary(project)


@app.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> None:
    projects = load_projects()
    next_projects = [project for project in projects if project["id"] != project_id]
    if len(next_projects) == len(projects):
        raise HTTPException(status_code=404, detail="Project not found")
    save_projects(next_projects)


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    _, project = find_project(project_id)
    return project


@app.put("/projects/{project_id}/images/{image_id}/annotation")
def update_annotation(project_id: str, image_id: str, payload: AnnotationUpdate) -> dict[str, Any]:
    projects, project = find_project(project_id)
    image = next((item for item in project["images"] if item["id"] == image_id), None)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")

    image["attributes"] = {}
    for attribute in project["attributes"]:
        image["attributes"][attribute] = validate_attribute_value(payload.attributes.get(attribute, 2))
    image["annotated"] = True
    project["updated_at"] = now_iso()
    save_projects(projects)
    return image


@app.get("/projects/{project_id}/export")
def export_project(project_id: str) -> StreamingResponse:
    _, project = find_project(project_id)
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


@app.get("/image")
def get_image(path: str) -> FileResponse:
    return FileResponse(resolve_image_path(path), headers={"Cache-Control": "no-store"})
