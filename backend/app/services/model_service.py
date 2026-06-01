from typing import Any
from pathlib import Path
from fastapi import (
    HTTPException
)
from app.schemas import (
    ModelConfig
)
from app.config import (
    MODEL_STATE, IMAGE_ROOT
)

def normalize_model_path(raw_path: str) -> Path:
    model_path = Path(raw_path)
    if not model_path.is_absolute():
        model_path = IMAGE_ROOT / model_path
    model_path = model_path.resolve()
    if not model_path.exists() or not model_path.is_file():
        raise HTTPException(status_code=400, detail=f"ONNX model not found: {model_path}")
    if model_path.suffix.lower() != ".onnx":
        raise HTTPException(status_code=400, detail="Model path must point to a .onnx file")
    return model_path


def normalize_input_size(raw_size: Any) -> tuple[int, int]:
    if isinstance(raw_size, dict):
        width = raw_size.get("width") or raw_size.get("w")
        height = raw_size.get("height") or raw_size.get("h")
    elif isinstance(raw_size, (list, tuple)) and len(raw_size) == 2:
        width, height = raw_size
    else:
        raise HTTPException(status_code=400, detail="input_size must be [width, height] or {width, height}")
    width = int(width)
    height = int(height)
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="input_size values must be positive")
    return width, height


def normalize_output_attributes(raw_attributes: Any) -> dict[str, dict[str, Any]]:
    if isinstance(raw_attributes, list):
        return {
            str(attribute): {"index": index, "threshold": 0.5, "unknown_margin": 0.0}
            for index, attribute in enumerate(raw_attributes)
        }
    if not isinstance(raw_attributes, dict):
        raise HTTPException(status_code=400, detail="output_attributes must be a list or mapping")

    normalized = {}
    for attribute, raw_mapping in raw_attributes.items():
        attribute_name = str(attribute).strip()
        if not attribute_name:
            continue
        if isinstance(raw_mapping, int):
            mapping = {"index": raw_mapping}
        elif isinstance(raw_mapping, dict):
            mapping = dict(raw_mapping)
        else:
            raise HTTPException(status_code=400, detail=f"Invalid mapping for attribute: {attribute_name}")
        if "index" not in mapping:
            raise HTTPException(status_code=400, detail=f"Missing output index for attribute: {attribute_name}")
        normalized[attribute_name] = {
            "index": int(mapping["index"]),
            "threshold": float(mapping.get("threshold", 0.5)),
            "unknown_margin": float(mapping.get("unknown_margin", 0.0)),
        }
    if not normalized:
        raise HTTPException(status_code=400, detail="No output attributes found in model config")
    return normalized


def parse_model_config(raw_config: Any) -> ModelConfig:
    if not isinstance(raw_config, dict):
        raise HTTPException(status_code=400, detail="Model config must be a YAML object")
    model_path = normalize_model_path(str(raw_config.get("model_path", "")).strip())
    input_size = normalize_input_size(raw_config.get("input_size"))
    raw_attributes = raw_config.get("output_attributes", raw_config.get("attributes"))
    attributes = normalize_output_attributes(raw_attributes)
    return ModelConfig(
        model_path=str(model_path),
        input_size=input_size,
        attributes=attributes,
        output_index=int(raw_config.get("output_index", 0)),
        input_layout=str(raw_config.get("input_layout", "NCHW")).upper(),
        input_dtype=str(raw_config.get("input_dtype", "auto")).lower(),
        mean=[float(value) for value in raw_config.get("mean", [0.0, 0.0, 0.0])],
        std=[float(value) for value in raw_config.get("std", [1.0, 1.0, 1.0])],
    )


def get_model_status() -> dict[str, Any]:
    config: ModelConfig | None = MODEL_STATE["config"]
    return {
        "loaded": MODEL_STATE["session"] is not None,
        "model_path": str(MODEL_STATE["model_path"]) if MODEL_STATE["model_path"] else None,
        "attributes": list(config.attributes.keys()) if config else [],
        "input_size": list(config.input_size) if config else None,
    }


def require_model() -> tuple[Any, ModelConfig, str]:
    session = MODEL_STATE["session"]
    config = MODEL_STATE["config"]
    input_name = MODEL_STATE["input_name"]
    if session is None or config is None or input_name is None:
        raise HTTPException(status_code=400, detail="No model loaded")
    return session, config, input_name


def resolve_model_input_dtype(session: Any, config: ModelConfig) -> str:
    if config.input_dtype != "auto":
        return config.input_dtype
    input_type = str(session.get_inputs()[0].type).lower()
    if "uint8" in input_type:
        return "uint8"
    if "float16" in input_type:
        return "float16"
    if "double" in input_type or "float64" in input_type:
        return "float64"
    return "float32"


def preprocess_image_for_model(image_path: Path, config: ModelConfig) -> Any:
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Pillow and numpy are required for model inference") from exc

    width, height = config.input_size
    with Image.open(image_path) as image:
        array = np.asarray(image.convert("RGB").resize((width, height)))

    session, _, _ = require_model()
    input_dtype = resolve_model_input_dtype(session, config)
    if input_dtype == "uint8":
        array = array.astype(np.uint8)
    else:
        np_dtype = {
            "float16": np.float16,
            "float32": np.float32,
            "float64": np.float64,
        }.get(input_dtype)
        if np_dtype is None:
            raise HTTPException(status_code=400, detail=f"Unsupported input_dtype: {input_dtype}")
        array = array.astype(np_dtype) / np_dtype(255.0)
        mean = np.asarray(config.mean, dtype=np_dtype).reshape(1, 1, 3)
        std = np.asarray(config.std, dtype=np_dtype).reshape(1, 1, 3)
        std = np.where(std == 0, 1.0, std)
        array = (array - mean) / std

    if config.input_layout == "NCHW":
        array = np.transpose(array, (2, 0, 1))[None, :, :, :]
    elif config.input_layout == "NHWC":
        array = array[None, :, :, :]
    else:
        raise HTTPException(status_code=400, detail="input_layout must be NCHW or NHWC")
    return array


def predict_image_attributes(image_path: Path) -> dict[str, int]:
    try:
        import numpy as np
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="numpy is required for model inference") from exc

    session, config, input_name = require_model()
    model_input = preprocess_image_for_model(image_path, config)
    outputs = session.run(None, {input_name: model_input})
    try:
        scores = np.asarray(outputs[config.output_index]).reshape(-1)
    except IndexError as exc:
        raise HTTPException(status_code=500, detail="Model output_index is out of range") from exc

    attributes = {}
    for attribute, mapping in config.attributes.items():
        index = mapping["index"]
        if index >= scores.size:
            raise HTTPException(status_code=500, detail=f"Output index out of range for attribute: {attribute}")
        score = float(scores[index])
        threshold = mapping["threshold"]
        unknown_margin = mapping["unknown_margin"]
        if unknown_margin > 0 and abs(score - threshold) <= unknown_margin:
            attributes[attribute] = 2
        else:
            attributes[attribute] = 1 if score >= threshold else 0
    return attributes
