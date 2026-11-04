"""Sparse text + dense handcrafted feature pipeline."""

from __future__ import annotations

import numpy as np
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler

from .signals import FEATURE_NAMES, extract_features

MAX_CHARS_FOR_CHAR_NGRAMS = 4_000


class FeaturePipeline:
    """TF-IDF word/char n-grams plus scaled handcrafted signals.

    Layout of the output matrix::

        [ word tfidf | char tfidf | handcrafted ]
    """

    def __init__(
        self,
        word_max_features: int = 30_000,
        char_max_features: int = 15_000,
    ) -> None:
        self.word_max_features = word_max_features
        self.char_max_features = char_max_features

    def _hand_matrix(self, texts: list[str]) -> np.ndarray:
        matrix = np.asarray(
            [
                [float(feats.get(key, 0.0)) for key in FEATURE_NAMES]
                for feats in (extract_features(text) for text in texts)
            ],
            dtype=np.float64,
        )
        return np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0)

    def _combine(self, word, char, hand) -> csr_matrix:
        return hstack(
            [word, char, csr_matrix(hand.astype(np.float32))], format="csr"
        )

    def fit(self, texts, y=None):  # noqa: ARG002 - sklearn API
        texts = list(texts)
        self.word_ = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=2,
            max_features=self.word_max_features,
            sublinear_tf=True,
            strip_accents="unicode",
            lowercase=True,
            dtype=np.float32,
        )
        self.char_ = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(3, 4),
            min_df=5,
            max_features=self.char_max_features,
            sublinear_tf=True,
            lowercase=True,
            dtype=np.float32,
        )
        word = self.word_.fit_transform(texts)
        char = self.char_.fit_transform(
            [text[:MAX_CHARS_FOR_CHAR_NGRAMS] for text in texts]
        )
        hand = self._hand_matrix(texts)
        self.scaler_ = StandardScaler()
        hand = self.scaler_.fit_transform(hand)

        self.word_n_ = word.shape[1]
        self.char_n_ = char.shape[1]
        self.hand_n_ = hand.shape[1]
        return self._combine(word, char, hand)

    def transform(self, texts) -> csr_matrix:
        texts = list(texts)
        word = self.word_.transform(texts)
        char = self.char_.transform(
            [text[:MAX_CHARS_FOR_CHAR_NGRAMS] for text in texts]
        )
        hand = self.scaler_.transform(self._hand_matrix(texts))
        return self._combine(word, char, hand)

    @property
    def feature_names(self) -> list[str]:
        word = list(self.word_.get_feature_names_out())
        char = [f"char:{name}" for name in self.char_.get_feature_names_out()]
        hand = list(FEATURE_NAMES)
        return word + char + hand
