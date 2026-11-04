"""Explainability: token contributions, dense-feature contributions, sentence
occlusion and highlight spans.

The model is linear, so a feature's contribution to the log-odds is simply
``value * coefficient``. That makes explanations cheap and faithful, unlike
post-hoc approximations such as LIME/SHAP.
"""

from __future__ import annotations

import re

import numpy as np

from .features.signals import FEATURE_LABELS, FEATURE_NAMES, LEXICONS

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n{2,}")
_WORD_BOUNDARY = r"\b{}\b"

_SEVERITY = {
    "credential": 3.0,
    "credential_request": 3.0,
    "urgency": 2.0,
    "threat": 2.0,
    "reward": 1.5,
    "cta": 1.0,
    "generic_greeting": 0.75,
    "ai_phrases": 0.5,
}


def _top_indices(values: np.ndarray, k: int, positive: bool = True) -> list[int]:
    if positive:
        order = np.argsort(values)[::-1]
        return [int(i) for i in order[:k] if values[i] > 0]
    order = np.argsort(values)
    return [int(i) for i in order[:k] if values[i] < 0]


def token_contributions(text: str, artifact: dict, k: int = 8) -> dict:
    """Return the words that push this message toward phishing / legitimate."""
    pipeline = artifact["pipeline"]
    model = artifact["model"]
    matrix = pipeline.transform([text]).tocsr()
    coef = model.coef_.ravel()
    row = matrix[0]
    word_n = pipeline.word_n_

    word_block = row[:, :word_n]
    names = pipeline.word_.get_feature_names_out()
    word_scores = word_block.data * coef[word_block.indices]
    lookup = {
        str(names[index]).lower(): float(score)
        for index, score in zip(word_block.indices, word_scores)
    }
    usable = {
        term: score
        for term, score in lookup.items()
        if len(term) >= 3 and re.search(r"[a-z]", term)
    }
    ranked = sorted(usable.items(), key=lambda item: item[1], reverse=True)
    phishing = [
        {"term": term, "score": round(score, 4)}
        for term, score in ranked
        if score > 0
    ][:k]
    legitimate = [
        {"term": term, "score": round(score, 4)}
        for term, score in reversed(ranked)
        if score < 0
    ][:k]

    offset = pipeline.word_n_ + pipeline.char_n_
    hand_block = row[:, offset : offset + pipeline.hand_n_].toarray().ravel()
    hand_scores = hand_block * coef[offset : offset + pipeline.hand_n_]
    hand_ranked = sorted(
        zip(FEATURE_NAMES, hand_scores), key=lambda item: item[1], reverse=True
    )
    features = [
        {
            "name": name,
            "label": FEATURE_LABELS.get(name, name.replace("_", " ")),
            "score": round(float(score), 4),
        }
        for name, score in hand_ranked
        if score > 0
    ][:k]

    return {"phishing_terms": phishing, "legitimate_terms": legitimate, "features": features}


def suspicious_sentences(
    text: str,
    predict,
    base_probability: float,
    k: int = 3,
    max_sentences: int = 25,
) -> list[dict]:
    """Occlusion: remove one sentence at a time and measure the score drop."""
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if len(s.strip()) >= 20]
    if len(sentences) < 2:
        return []

    results: list[dict] = []
    for sentence in sentences[:max_sentences]:
        reduced = text.replace(sentence, " ", 1)
        if reduced.strip() == text.strip():
            continue
        reduced_prob = float(predict([reduced])[0])
        delta = base_probability - reduced_prob
        if delta > 0.005:
            results.append(
                {
                    "text": sentence[:260],
                    "delta": round(float(delta), 4),
                    "score": int(round(min(1.0, delta * 3) * 100)),
                }
            )
    return sorted(results, key=lambda item: item["delta"], reverse=True)[:k]


def lexicon_hits(text: str) -> list[dict]:
    """Find known risky phrases in the raw text (for highlighting)."""
    lower = text.lower()
    hits: list[dict] = []
    for category, terms in LEXICONS.items():
        weight = _SEVERITY.get(category, 0.5)
        for term in terms:
            pattern = _WORD_BOUNDARY.format(re.escape(term)) if " " not in term else re.escape(term)
            if re.search(pattern, lower):
                hits.append({"term": term, "category": category, "weight": weight})
    return hits


def highlight_spans(text: str, terms: list[str]) -> list[dict]:
    """Find non-overlapping character spans for a set of terms."""
    spans: list[dict] = []
    seen: set[str] = set()
    for term in terms:
        key = term.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        pattern = _WORD_BOUNDARY.format(re.escape(term)) if " " not in term else re.escape(term)
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            spans.append(
                {
                    "start": match.start(),
                    "end": match.end(),
                    "text": match.group(0),
                    "term": term,
                }
            )

    spans.sort(key=lambda item: (item["start"], -item["end"]))
    merged: list[dict] = []
    for span in spans:
        if merged and span["start"] < merged[-1]["end"]:
            if span["end"] > merged[-1]["end"]:
                merged[-1]["end"] = span["end"]
                merged[-1]["text"] = text[merged[-1]["start"] : merged[-1]["end"]]
            continue
        merged.append(span)
    return merged[:60]
