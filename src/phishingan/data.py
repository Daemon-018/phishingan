"""Download, clean and split the phishing corpora.

Two sources are used:

* ``classic`` — the Kaggle / zefang-liu phishing email corpus. Human-written
  phishing and Enron-era legitimate mail.
* ``llm`` — the Dizzzy0x00 LLM-generated corpus. Phishing and legitimate mail
  written by a large language model.

Keeping the sources separate lets us measure the exact failure mode this
project is about: a detector trained on human-written phishing, evaluated on
fluent machine-written phishing.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import pandas as pd
import requests
from sklearn.model_selection import train_test_split

from .config import (
    DATASET_PATH,
    PROCESSED_DIR,
    RAW_DIR,
    STATS_PATH,
    ensure_dirs,
)

CLASSIC_URL = (
    "https://huggingface.co/datasets/zefang-liu/phishing-email-dataset/"
    "resolve/main/Phishing_Email.csv"
)
LLM_URL = (
    "https://huggingface.co/datasets/Dizzzy0x00/LLMGen-Phishing-Email-Dataset/"
    "resolve/main/GPT_Phishing_Email_dataset.csv"
)

CLASSIC_PATH = RAW_DIR / "phishing_email.csv"
LLM_PATH = RAW_DIR / "llm_phishing.csv"

MAX_CHARS = 8_000
MIN_CHARS = 40
RANDOM_STATE = 42


def _download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        with tmp.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1 << 20):
                if chunk:
                    handle.write(chunk)
    tmp.replace(dest)
    return dest


def clean_text(value: object, max_chars: int = MAX_CHARS) -> str:
    """Unicode-normalise, tidy whitespace and cap length.

    Capping matters: a handful of legitimate emails are megabytes of quoted
    mailing-list text and would otherwise dominate both training time and
    feature scaling.
    """
    if not isinstance(value, str):
        return ""
    text = unicodedata.normalize("NFKC", value)
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()
    return text[:max_chars]


def load_classic() -> pd.DataFrame:
    _download(CLASSIC_URL, CLASSIC_PATH)
    df = pd.read_csv(CLASSIC_PATH)
    df = df.rename(columns={"Email Text": "text", "Email Type": "label"})
    df = df[["text", "label"]].copy()
    df["label"] = df["label"].map({"Phishing Email": 1, "Safe Email": 0})
    df = df.dropna(subset=["label"])
    df["label"] = df["label"].astype(int)
    df["source"] = "classic"
    return df


def load_llm() -> pd.DataFrame:
    _download(LLM_URL, LLM_PATH)
    df = pd.read_csv(LLM_PATH)
    df = df.rename(columns={"content": "text"})
    df = df[["text", "label"]].copy()
    df["label"] = pd.to_numeric(df["label"], errors="coerce")
    df = df.dropna(subset=["label"])
    df["label"] = df["label"].astype(int)
    df["source"] = "llm"
    return df


def _dedup_key(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def build_dataset(force: bool = False) -> pd.DataFrame:
    """Build ``data/processed/dataset.csv`` with train/val/test splits.

    Splits are stratified per source. A text duplicated across sources is kept
    once, so the model cannot memorise the same message twice.
    """
    ensure_dirs()
    if DATASET_PATH.exists() and not force:
        return pd.read_csv(DATASET_PATH)

    frames = [load_classic(), load_llm()]
    df = pd.concat(frames, ignore_index=True)
    df["text"] = df["text"].map(clean_text)
    df = df[df["text"].str.len() >= MIN_CHARS].copy()
    df["_key"] = df["text"].map(_dedup_key)
    df = df.drop_duplicates("_key").drop(columns="_key").reset_index(drop=True)

    splits = []
    for source, group in df.groupby("source"):
        if len(group) < 20 or group["label"].nunique() < 2:
            raise ValueError(f"source {source!r} is too small to split safely")
        train, rest = train_test_split(
            group,
            test_size=0.30,
            stratify=group["label"],
            random_state=RANDOM_STATE,
        )
        val, test = train_test_split(
            rest,
            test_size=0.50,
            stratify=rest["label"],
            random_state=RANDOM_STATE,
        )
        train = train.assign(split="train")
        val = val.assign(split="val")
        test = test.assign(split="test")
        splits.extend([train, val, test])

    out = pd.concat(splits, ignore_index=True)
    out = out[["text", "label", "source", "split"]]
    out.to_csv(DATASET_PATH, index=False)

    stats = {
        "rows": int(len(out)),
        "by_source": out.groupby("source")["label"].agg(["count", "sum"]).to_dict(),
        "by_split": out.groupby("split")["label"].agg(["count", "sum"]).to_dict(),
        "duplicates_removed": int(len(df) - len(out)),
        "max_chars": MAX_CHARS,
    }
    STATS_PATH.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    return out


def load_dataset() -> pd.DataFrame:
    if not DATASET_PATH.exists():
        return build_dataset()
    return pd.read_csv(DATASET_PATH)


def dataset_stats() -> dict:
    df = load_dataset()
    return {
        "rows": int(len(df)),
        "sources": df.groupby("source").size().to_dict(),
        "splits": df.groupby("split").size().to_dict(),
        "phishing_rate": round(float(df["label"].mean()), 4),
    }
