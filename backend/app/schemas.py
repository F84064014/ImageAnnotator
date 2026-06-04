from typing import Any
from pydantic import BaseModel, Field

class MaskLabel(BaseModel):
    name: str = Field(min_length=1)
    directory: str = Field(min_length=1)
    color: str = "#ff3b8f"
    opacity: float = 0.55


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    attributes: list[str] = Field(min_length=1)
    image_directory: str = Field(min_length=1)
    mask_labels: list[MaskLabel] = Field(default_factory=list)


class AnnotationUpdate(BaseModel):
    attributes: dict[str, int]


class ProjectSettingsUpdate(BaseModel):
    image_directory: str = Field(min_length=1)
    attributes: list[str] = Field(min_length=1)
    mask_labels: list[MaskLabel] = Field(default_factory=list)


class ProjectExportRequest(BaseModel):
    project_ids: list[str] = Field(min_length=1)


class ImageDeleteRequest(BaseModel):
    delete_file: bool = False


class ModelConfig(BaseModel):
    model_path: str
    input_size: tuple[int, int]
    attributes: dict[str, dict[str, Any]]
    output_index: int = 0
    input_layout: str = "NCHW"
    input_dtype: str = "auto"
    mean: list[float] = [0.0, 0.0, 0.0]
    std: list[float] = [1.0, 1.0, 1.0]
