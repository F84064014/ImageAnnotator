from typing import Any
from pathlib import Path
from fastapi import (
    APIRouter, HTTPException,
    UploadFile, File
)
from app.config import (
    MODEL_STATE
)
from app.services.model_service import (
    get_model_status, parse_model_config
)

router = APIRouter()

@router.get("/model/status")
def model_status() -> dict[str, Any]:
    return get_model_status()


@router.post("/model/load")
async def load_model(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename.lower().endswith((".yml", ".yaml")):
        raise HTTPException(status_code=400, detail="Please upload a .yml or .yaml model config")

    try:
        import onnxruntime as ort
        import yaml
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="onnxruntime and PyYAML are required to load models") from exc

    try:
        raw_config = yaml.safe_load((await file.read()).decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Model config must be UTF-8 YAML") from exc

    config = parse_model_config(raw_config)
    try:
        session = ort.InferenceSession(config.model_path, providers=["CPUExecutionProvider"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to load ONNX model: {exc}") from exc

    MODEL_STATE["session"] = session
    MODEL_STATE["config"] = config
    MODEL_STATE["model_path"] = Path(config.model_path)
    MODEL_STATE["input_name"] = session.get_inputs()[0].name
    return get_model_status()


@router.post("/model/unload")
def unload_model() -> dict[str, Any]:
    MODEL_STATE["session"] = None
    MODEL_STATE["config"] = None
    MODEL_STATE["model_path"] = None
    MODEL_STATE["input_name"] = None
    return get_model_status()
