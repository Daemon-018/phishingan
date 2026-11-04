"""FastAPI application and JSON API."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .config import WEB_DIR
from .samples import get_samples
from .scanner import Scanner


class ScanRequest(BaseModel):
    text: str = Field(..., min_length=10, max_length=50_000)
    html: str | None = Field(default=None, max_length=200_000)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.scanner = Scanner()
    yield


app = FastAPI(
    title="PhishinGAN",
    version=__version__,
    description="Explainable detection of AI-generated phishing messages.",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/health")
def health() -> dict:
    scanner: Scanner = app.state.scanner
    return {
        "status": "ok",
        "version": __version__,
        "model_available": scanner.model_available,
        "model_error": scanner.model_error,
    }


@app.get("/api/samples")
def samples() -> dict:
    return {"samples": get_samples()}


@app.post("/api/scan")
def scan(request: ScanRequest) -> dict:
    scanner: Scanner = app.state.scanner
    try:
        return scanner.analyze(request.text, request.html)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
