"""Create a sample file for Python-vs-JavaScript model parity checks."""

from __future__ import annotations

import json

import pandas as pd

from phishingan.config import DATASET_PATH, REPORTS_DIR
from phishingan.model import load_artifact, predict_proba
from phishingan.samples import get_samples

OUT = REPORTS_DIR / "js_validation.json"


def main() -> int:
    df = pd.read_csv(DATASET_PATH)
    test = df[df["split"] == "test"]
    phishing = test[test["label"] == 1].sample(30, random_state=7)
    legit = test[test["label"] == 0].sample(30, random_state=7)
    rows = pd.concat([phishing, legit])

    artifact = load_artifact()
    probabilities = predict_proba(artifact, rows["text"].tolist())

    cases = [
        {
            "text": text,
            "expected": round(float(probability), 6),
            "label": int(label),
            "source": source,
        }
        for text, probability, label, source in zip(
            rows["text"].tolist(), probabilities, rows["label"], rows["source"]
        )
    ]
    cases.extend(
        {
            "text": sample["text"],
            "expected": None,
            "label": None,
            "source": "sample",
            "title": sample["title"],
        }
        for sample in get_samples()
    )

    # Fill expected scores for curated samples too.
    missing = [case for case in cases if case["expected"] is None]
    if missing:
        sample_probs = predict_proba(artifact, [case["text"] for case in missing])
        for case, probability in zip(missing, sample_probs):
            case["expected"] = round(float(probability), 6)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases, indent=2), encoding="utf-8")
    print(f"wrote {len(cases)} cases -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
