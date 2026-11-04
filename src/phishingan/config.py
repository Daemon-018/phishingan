"""Filesystem locations and shared constants."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
SAMPLE_DIR = DATA_DIR / "samples"

MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "phishingan.joblib"

REPORTS_DIR = ROOT / "reports"
WEB_DIR = Path(__file__).resolve().parent / "web"

DATASET_PATH = PROCESSED_DIR / "dataset.csv"
STATS_PATH = PROCESSED_DIR / "stats.json"


def ensure_dirs() -> None:
    """Create every directory the pipeline writes to."""
    for path in (RAW_DIR, PROCESSED_DIR, SAMPLE_DIR, MODEL_DIR, REPORTS_DIR):
        path.mkdir(parents=True, exist_ok=True)
