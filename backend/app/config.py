import os
from typing import Any
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
IMAGE_ROOT = Path(os.getenv("IMAGE_ROOT", "/images")).resolve()
LEGACY_PROJECTS_FILE = DATA_DIR / "projects.json"
PROJECTS_DIR = DATA_DIR / "projects"
PROJECTS_META_FILE = PROJECTS_DIR / "meta.json"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"}
MODEL_STATE: dict[str, Any] = {
    "session": None,
    "config": None,
    "model_path": None,
    "input_name": None,
}
