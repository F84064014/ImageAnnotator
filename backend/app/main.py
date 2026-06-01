from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import (
    PROJECT_ROUTER, MODEL_ROUTER
)


app = FastAPI(title="Image Annotator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(PROJECT_ROUTER)
app.include_router(MODEL_ROUTER)

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
