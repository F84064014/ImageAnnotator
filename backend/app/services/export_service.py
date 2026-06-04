import csv
import io
import pickle
import tempfile
import threading
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

import numpy as np
from fastapi import HTTPException

from app.services.project_service import (
    load_project,
    load_project_meta,
    mask_path_for_image,
    normalize_attribute_value,
    resolve_image_path,
    safe_project_stem,
)

EXPORT_JOBS: dict[str, dict[str, Any]] = {}
EXPORT_JOBS_LOCK = threading.Lock()


def build_mask_status(project: dict[str, Any]) -> dict[str, dict[str, bool]]:
    mask_labels = project.get("mask_labels", [])
    return {
        image["id"]: {
            mask_label["name"]: mask_path_for_image(
                image["path"],
                mask_label,
                project["image_directory"],
            ).exists()
            for mask_label in mask_labels
        }
        for image in project.get("images", [])
    }


def export_image_suffix(path: Path) -> str:
    if path.suffix.lower() == ".png":
        return ".png"
    return ".jpg"


def write_export_image(zip_file: zipfile.ZipFile, source_path: Path, archive_name: str) -> None:
    if source_path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
        zip_file.write(source_path, archive_name)
        return

    try:
        from PIL import Image
        with Image.open(source_path) as image:
            with zip_file.open(archive_name, "w") as target:
                image.convert("RGB").save(target, format="JPEG", quality=95)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to export image {source_path}: {exc}") from exc


def write_export_mask(zip_file: zipfile.ZipFile, source_path: Path, archive_name: str) -> None:
    try:
        from PIL import Image
        with Image.open(source_path) as image:
            with zip_file.open(archive_name, "w") as target:
                image.convert("L").save(target, format="JPEG", quality=100, subsampling=0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to export mask {source_path}: {exc}") from exc


def cleanup_export(path: str) -> None:
    Path(path).unlink(missing_ok=True)


def create_projects_export(
    project_ids: list[str],
    progress_callback: Callable[[int, int], None] | None = None,
) -> tuple[Path, str]:
    meta = load_project_meta()
    meta_by_id = {item["id"]: item for item in meta}
    projects = []
    for project_id in project_ids:
        meta_item = meta_by_id.get(project_id)
        if meta_item is None:
            raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
        projects.append(load_project(meta_item))

    attr_name = []
    seen_attributes: set[str] = set()
    for project in projects:
        for attribute in project["attributes"]:
            if attribute not in seen_attributes:
                seen_attributes.add(attribute)
                attr_name.append(attribute)

    export_rows = [
        (project, image)
        for project in projects
        for image in project.get("images", [])
    ]
    if not export_rows:
        raise HTTPException(status_code=400, detail="Selected projects do not contain images")

    timestamp = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y_%m%d_%H%M")
    export_stem = f"ExportData_{timestamp}"
    temp_zip = tempfile.NamedTemporaryFile(prefix=export_stem, suffix=".zip", delete=False)
    temp_zip_path = Path(temp_zip.name)
    temp_zip.close()

    width = max(1, len(str(len(export_rows) - 1)))
    image_name = []
    labels = []
    csv_buffer = io.StringIO()
    csv_writer = csv.writer(csv_buffer)
    csv_writer.writerow(["image_path", *attr_name])

    try:
        with zipfile.ZipFile(temp_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            for index, (project, image) in enumerate(export_rows):
                source_path = resolve_image_path(image["path"])
                export_basename = str(index).zfill(width)
                image_archive_name = f"images/{export_basename}{export_image_suffix(source_path)}"
                write_export_image(zip_file, source_path, image_archive_name)
                image_name.append(image_archive_name)

                image_attributes = image.get("attributes", {})
                labels.append([
                    normalize_attribute_value(image_attributes.get(attribute, 2))
                    for attribute in attr_name
                ])
                csv_writer.writerow([image_archive_name, *labels[-1]])

                mask_labels = project.get("mask_labels", [])
                for mask_label in mask_labels:
                    mask_path = mask_path_for_image(image["path"], mask_label, project["image_directory"])
                    if not mask_path.exists():
                        continue
                    if len(mask_labels) == 1:
                        mask_archive_name = f"masks/{export_basename}.jpg"
                    else:
                        mask_archive_name = f"masks/{export_basename}_{safe_project_stem(mask_label['name'])}.jpg"
                    write_export_mask(zip_file, mask_path, mask_archive_name)
                if progress_callback:
                    progress_callback(index + 1, len(export_rows))

            dataset = {
                "image_name": image_name,
                "attr_name": attr_name,
                "label": np.asarray(labels, dtype=np.uint8),
            }
            zip_file.writestr(f"{export_stem}.pkl", pickle.dumps(dataset, protocol=pickle.HIGHEST_PROTOCOL))
            zip_file.writestr(f"{export_stem}.csv", csv_buffer.getvalue())
    except Exception:
        cleanup_export(str(temp_zip_path))
        raise

    return temp_zip_path, f"{export_stem}.zip"


def export_job_snapshot(job_id: str) -> dict[str, Any]:
    with EXPORT_JOBS_LOCK:
        job = EXPORT_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Export job not found")
        return {key: value for key, value in job.items() if key != "path"}


def update_export_job(job_id: str, **patch: Any) -> None:
    with EXPORT_JOBS_LOCK:
        job = EXPORT_JOBS.get(job_id)
        if job is not None:
            job.update(patch)


def run_export_job(job_id: str, project_ids: list[str]) -> None:
    def update_progress(completed: int, total: int) -> None:
        update_export_job(
            job_id,
            completed=completed,
            total=total,
            progress=round((completed / total) * 100, 1) if total else 0,
        )

    update_export_job(job_id, status="running")
    try:
        path, filename = create_projects_export(project_ids, progress_callback=update_progress)
        update_export_job(
            job_id,
            status="complete",
            progress=100,
            path=str(path),
            filename=filename,
        )
    except Exception as exc:
        update_export_job(
            job_id,
            status="error",
            error=str(getattr(exc, "detail", exc)),
        )


def start_projects_export_job(project_ids: list[str]) -> dict[str, Any]:
    job_id = str(uuid.uuid4())
    with EXPORT_JOBS_LOCK:
        EXPORT_JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "completed": 0,
            "total": 0,
            "filename": "",
            "error": "",
        }
    thread = threading.Thread(target=run_export_job, args=(job_id, project_ids), daemon=True)
    thread.start()
    return export_job_snapshot(job_id)


def get_completed_export_job(job_id: str) -> dict[str, Any]:
    with EXPORT_JOBS_LOCK:
        job = EXPORT_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Export job not found")
        if job.get("status") != "complete" or not job.get("path"):
            raise HTTPException(status_code=409, detail="Export job is not ready")
        return dict(job)


def cleanup_export_job(job_id: str) -> None:
    with EXPORT_JOBS_LOCK:
        job = EXPORT_JOBS.pop(job_id, None)
    if job and job.get("path"):
        cleanup_export(job["path"])
