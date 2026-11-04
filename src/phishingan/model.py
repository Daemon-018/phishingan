"""Training, evaluation and persistence."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from .config import MODEL_PATH, ensure_dirs
from .features.builder import FeaturePipeline


def _safe_auc(metric, y_true, prob) -> float | None:
    if len(set(y_true)) < 2:
        return None
    return round(float(metric(y_true, prob)), 4)


def metrics_at(y_true, prob, threshold: float) -> dict:
    pred = (np.asarray(prob) >= threshold).astype(int)
    y_true = np.asarray(y_true)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "threshold": round(float(threshold), 4),
        "accuracy": round(float(accuracy_score(y_true, pred)), 4),
        "precision": round(float(precision_score(y_true, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, pred, zero_division=0)), 4),
        "roc_auc": _safe_auc(roc_auc_score, y_true, prob),
        "pr_auc": _safe_auc(average_precision_score, y_true, prob),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "false_positive_rate": round(float(fp / max(1, fp + tn)), 4),
    }


def choose_threshold(y_true, prob) -> float:
    best_t, best_f1 = 0.5, -1.0
    for threshold in np.linspace(0.05, 0.95, 91):
        score = f1_score(y_true, (np.asarray(prob) >= threshold).astype(int), zero_division=0)
        if score > best_f1:
            best_t, best_f1 = float(threshold), float(score)
    return best_t


def predict_proba(artifact: dict, texts: list[str]) -> np.ndarray:
    matrix = artifact["pipeline"].transform(texts)
    return artifact["model"].predict_proba(matrix)[:, 1]


def _select(df: pd.DataFrame, split: str, sources: list[str] | None) -> pd.DataFrame:
    part = df[df["split"] == split]
    if sources is not None:
        part = part[part["source"].isin(sources)]
    return part


def train_model(
    df: pd.DataFrame,
    train_sources: list[str] | None = None,
    path: Path | None = MODEL_PATH,
    verbose: bool = True,
) -> dict:
    """Fit the hybrid feature pipeline + logistic model.

    ``train_sources=None`` means train on every source that has a ``train``
    split. Thresholds are chosen on the matching validation split(s).
    """
    train = _select(df, "train", train_sources)
    val = _select(df, "val", train_sources)
    if train.empty or val.empty:
        raise ValueError("no training/validation rows for the requested sources")
    if len(set(val["label"])) < 2:
        val = train

    pipeline = FeaturePipeline()
    matrix = pipeline.fit(train["text"].tolist())
    model = LogisticRegression(
        C=2.0,
        max_iter=2_000,
        class_weight="balanced",
        solver="liblinear",
        random_state=42,
    )
    model.fit(matrix, train["label"].to_numpy())

    val_prob = model.predict_proba(pipeline.transform(val["text"].tolist()))[:, 1]
    threshold = choose_threshold(val["label"].to_numpy(), val_prob)

    artifact = {
        "pipeline": pipeline,
        "model": model,
        "threshold": threshold,
        "metadata": {
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "train_sources": train_sources or sorted(df["source"].unique().tolist()),
            "train_rows": int(len(train)),
            "val_rows": int(len(val)),
            "features": int(matrix.shape[1]),
            "positive_rate": round(float(train["label"].mean()), 4),
        },
    }

    if path is not None:
        ensure_dirs()
        joblib.dump(artifact, path, compress=3)
        if verbose:
            print(f"saved model -> {path}")

    return artifact


def evaluate_artifact(artifact: dict, df: pd.DataFrame, split: str = "test") -> dict:
    """Evaluate on every source in ``split`` plus the pooled set."""
    test = df[df["split"] == split]
    if test.empty:
        return {}
    probabilities = predict_proba(artifact, test["text"].tolist())
    threshold = artifact["threshold"]

    report: dict = {
        "overall": metrics_at(test["label"], probabilities, threshold),
        "by_source": {},
    }
    for source, group in test.groupby("source"):
        index = group.index
        positions = test.index.get_indexer(index)
        report["by_source"][source] = metrics_at(
            group["label"], probabilities[positions], threshold
        )
    return report


def run_source_experiments(df: pd.DataFrame) -> dict:
    """The experiment that motivates the project.

    Train on classic-only, LLM-only and combined; evaluate each on both test
    sets. The classic-only model's LLM recall is the interesting number.
    """
    experiments = {
        "classic_only": ["classic"],
        "llm_only": ["llm"],
        "combined": ["classic", "llm"],
    }
    results: dict = {}
    for name, sources in experiments.items():
        artifact = train_model(df, train_sources=sources, path=None, verbose=False)
        results[name] = evaluate_artifact(artifact, df)
    return results


def save_report(report: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def load_artifact(path: Path | None = None) -> dict:
    target = path or MODEL_PATH
    return joblib.load(target)
