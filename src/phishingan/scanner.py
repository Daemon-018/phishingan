"""High-level scan orchestration: model + rules + URLs + explanations."""

from __future__ import annotations

from pathlib import Path

from .config import MODEL_PATH
from .data import clean_text
from .explain import (
    highlight_spans,
    lexicon_hits,
    suspicious_sentences,
    token_contributions,
)
from .features.signals import extract_features, rule_signals
from .features.urls import analyze_url, extract_urls
from .model import load_artifact, predict_proba

MODEL_WEIGHT = 0.80
RULE_WEIGHT = 0.20


class Scanner:
    def __init__(
        self,
        artifact: dict | None = None,
        model_path: Path | None = None,
        load_model: bool = True,
    ) -> None:
        self.artifact = artifact
        self.model_error: str | None = None
        if self.artifact is None and load_model:
            try:
                self.artifact = load_artifact(model_path or MODEL_PATH)
            except Exception as exc:  # noqa: BLE001 - rules-only fallback is intentional
                self.model_error = f"{type(exc).__name__}: {exc}"
                self.artifact = None

    @property
    def model_available(self) -> bool:
        return self.artifact is not None

    def _predict(self, texts: list[str]):
        if self.artifact is None:
            raise RuntimeError("model is not loaded")
        return predict_proba(self.artifact, texts)

    def analyze(self, text: str, html: str | None = None) -> dict:
        raw = (text or "") + (("\n" + html) if html else "")
        message = clean_text(raw, max_chars=12_000)
        if len(message) < 10:
            raise ValueError("message is too short to analyse")

        feats = extract_features(message)
        signals = rule_signals(feats)
        rule_points = sum(signal["weight"] for signal in signals)
        rule_score = min(1.0, rule_points / 10.0)

        urls = [analyze_url(url) for url in extract_urls(message)]
        url_flags: dict[str, dict] = {}
        for info in urls:
            for flag in info["flags"]:
                current = url_flags.get(flag["code"])
                if current is None or flag["points"] > current["points"]:
                    url_flags[flag["code"]] = flag

        model_prob: float | None = None
        contributions: dict = {"phishing_terms": [], "legitimate_terms": [], "features": []}
        if self.artifact is not None:
            model_prob = float(self._predict([message])[0])
            final_score = MODEL_WEIGHT * model_prob + RULE_WEIGHT * rule_score
            contributions = token_contributions(message, self.artifact)
        else:
            final_score = rule_score

        threshold = float(self.artifact["threshold"]) if self.artifact else 0.60
        phishing_cut = min(0.85, max(0.50, threshold))
        suspicious_cut = max(0.25, phishing_cut - 0.30)
        if final_score >= phishing_cut:
            verdict = "phishing"
        elif final_score >= suspicious_cut:
            verdict = "suspicious"
        else:
            verdict = "legitimate"

        reasons: list[dict] = []

        for signal in signals:
            reasons.append(
                {
                    "category": signal["category"],
                    "label": signal["label"],
                    "detail": signal["detail"],
                    "weight": signal["weight"],
                }
            )

        for flag in url_flags.values():
            reasons.append(
                {
                    "category": "url",
                    "label": flag["label"],
                    "detail": "Structural URL signal; the link was not opened.",
                    "weight": flag["points"],
                }
            )

        for item in contributions["phishing_terms"][:5]:
            reasons.append(
                {
                    "category": "model",
                    "label": f"Phishing-associated wording: “{item['term']}”",
                    "detail": "This token increases the model's phishing score.",
                    "weight": min(3.0, item["score"]),
                }
            )

        for item in contributions["features"][:4]:
            reasons.append(
                {
                    "category": "model",
                    "label": item["label"].capitalize(),
                    "detail": "Handcrafted signal weighted toward phishing by the model.",
                    "weight": min(3.0, item["score"]),
                }
            )

        if model_prob is not None:
            sentences = suspicious_sentences(
                message, self._predict, base_probability=model_prob
            )
        else:
            sentences = []
        for item in sentences:
            reasons.append(
                {
                    "category": "sentence",
                    "label": "Suspicious sentence",
                    "detail": f"“{item['text']}”",
                    "weight": min(3.0, item["delta"] * 6),
                }
            )

        reasons = _dedupe(reasons)
        reasons.sort(key=lambda item: item["weight"], reverse=True)
        reasons = reasons[:10]
        top_weight = max((item["weight"] for item in reasons), default=1.0)
        for item in reasons:
            item["strength"] = int(round(100 * item["weight"] / max(top_weight, 0.01)))

        highlight_terms = [item["term"] for item in contributions["phishing_terms"]]
        highlight_terms += [hit["term"] for hit in lexicon_hits(message)]
        spans = highlight_spans(message, highlight_terms)

        return {
            "verdict": verdict,
            "risk_score": int(round(final_score * 100)),
            "confidence": int(round(max(final_score, 1 - final_score) * 100)),
            "model": {
                "available": self.artifact is not None,
                "probability": None if model_prob is None else round(model_prob, 4),
                "weight": MODEL_WEIGHT if self.artifact is not None else 0.0,
                "threshold": round(phishing_cut, 4),
                "error": self.model_error,
            },
            "rules": {
                "score": round(rule_score, 4),
                "points": round(rule_points, 2),
                "weight": RULE_WEIGHT if self.artifact is not None else 1.0,
            },
            "reasons": reasons,
            "urls": [
                {
                    "url": info["url"],
                    "defanged": info["defanged"],
                    "host": info["host"],
                    "risk": int(round(min(1.0, info["points"] / 8.0) * 100)),
                    "flags": info["flags"],
                }
                for info in urls
            ],
            "highlights": spans,
            "suspicious_sentences": sentences,
            "text": message,
            "stats": {
                "characters": int(feats["n_chars"]),
                "words": int(feats["n_words"]),
                "sentences": int(feats["n_sentences"]),
                "links": len(urls),
            },
            "thresholds": {
                "phishing": round(phishing_cut, 4),
                "suspicious": round(suspicious_cut, 4),
            },
        }


def _dedupe(reasons: list[dict]) -> list[dict]:
    seen: set[str] = set()
    unique: list[dict] = []
    for reason in reasons:
        key = reason["label"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(reason)
    return unique
