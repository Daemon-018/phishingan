"""Export the trained sklearn model into a compact JSON file for the extension.

The extension reproduces TF-IDF + logistic regression in JavaScript, so scanning
is local, instant and free. Run after ``phishingan train``.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib

from phishingan.config import MODEL_PATH, ROOT
from phishingan.features.signals import FEATURE_LABELS, FEATURE_NAMES, LEXICONS
from phishingan.features.urls import BRAND_DOMAINS, BRANDS, SHORTENERS, SUSPICIOUS_TLDS

OUT_PATH = ROOT / "extension" / "model" / "model.json"


def _round(values) -> list[float]:
    return [round(float(value), 5) for value in values]


def build_payload() -> dict:
    artifact = joblib.load(MODEL_PATH)
    pipeline = artifact["pipeline"]
    model = artifact["model"]
    coef = model.coef_.ravel()

    word_end = pipeline.word_n_
    char_end = word_end + pipeline.char_n_

    return {
        "version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "threshold": round(float(artifact["threshold"]), 5),
        "intercept": round(float(model.intercept_[0]), 5),
        "word": {
            "terms": list(pipeline.word_.get_feature_names_out()),
            "idf": _round(pipeline.word_.idf_),
            "coef": _round(coef[:word_end]),
        },
        "char": {
            "terms": list(pipeline.char_.get_feature_names_out()),
            "idf": _round(pipeline.char_.idf_),
            "coef": _round(coef[word_end:char_end]),
        },
        "hand": {
            "names": list(FEATURE_NAMES),
            "labels": FEATURE_LABELS,
            "mean": _round(pipeline.scaler_.mean_),
            "scale": _round(pipeline.scaler_.scale_),
            "coef": _round(coef[char_end:]),
        },
        "lexicons": LEXICONS,
        "url": {
            "shorteners": sorted(SHORTENERS),
            "suspicious_tlds": sorted(SUSPICIOUS_TLDS),
            "brands": sorted(BRANDS),
            "brand_domains": {brand: list(domains) for brand, domains in BRAND_DOMAINS.items()},
        },
    }


def main() -> int:
    payload = build_payload()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size = OUT_PATH.stat().st_size
    print(f"exported {size / 1e6:.2f} MB -> {OUT_PATH}")
    print(
        f"word={len(payload['word']['terms'])} "
        f"char={len(payload['char']['terms'])} "
        f"hand={len(payload['hand']['names'])} "
        f"threshold={payload['threshold']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
