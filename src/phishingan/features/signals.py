"""Linguistic, intent and stylometric features.

These are deliberately human-readable. A linear model on top of them can say
*why* a message looks wrong, which is the difference between a demo and a tool.
"""

from __future__ import annotations

import re

from .urls import URL_FEATURE_KEYS, extract_urls, url_features

# Terms are lower-case. Multi-word phrases are matched as substrings; single
# words are matched on word boundaries.
LEXICONS: dict[str, list[str]] = {
    "credential": [
        "password",
        "username",
        "login",
        "log in",
        "sign in",
        "signin",
        "verify",
        "verification",
        "confirm",
        "update your account",
        "billing information",
        "payment details",
        "credit card",
        "debit card",
        "card number",
        "social security",
        "ssn",
        "one-time password",
        "otp",
        "pin code",
        "cvv",
        "security code",
        "account number",
        "re-authenticate",
        "validate your account",
    ],
    "urgency": [
        "immediately",
        "urgent",
        "within 24 hours",
        "within 48 hours",
        "expires today",
        "expiring soon",
        "act now",
        "final notice",
        "last warning",
        "last chance",
        "limited time",
        "as soon as possible",
        "right away",
        "don't delay",
        "do not delay",
        "time-sensitive",
        "suspended within",
    ],
    "threat": [
        "suspended",
        "locked",
        "terminated",
        "deactivated",
        "disabled",
        "compromised",
        "unauthorized access",
        "unusual activity",
        "suspicious activity",
        "legal action",
        "permanent closure",
        "account closure",
        "will be deleted",
        "lose access",
        "failure to",
        "avoid suspension",
        "restricted",
    ],
    "authority": [
        "dear customer",
        "dear user",
        "dear client",
        "dear member",
        "valued customer",
        "security team",
        "support team",
        "administrator",
        "it department",
        "help desk",
        "account team",
        "compliance team",
        "official notice",
        "government",
        "tax department",
        "bank",
    ],
    "reward": [
        "congratulations",
        "you have won",
        "winner",
        "prize",
        "reward",
        "gift card",
        "free gift",
        "selected",
        "lottery",
        "refund",
        "cash bonus",
        "claim now",
        "exclusive offer",
        "you are eligible",
        "compensation",
    ],
    "cta": [
        "click here",
        "click the link",
        "click below",
        "verify now",
        "login now",
        "log in now",
        "update now",
        "confirm now",
        "download now",
        "open the attachment",
        "open attachment",
        "review the document",
        "sign the document",
        "follow this link",
        "access your account",
        "restore access",
    ],
    "generic_greeting": [
        "dear customer",
        "dear user",
        "dear client",
        "dear member",
        "dear sir",
        "dear madam",
        "valued customer",
        "dear account holder",
    ],
    "ai_phrases": [
        "i hope this email finds you well",
        "i hope this message finds you well",
        "i hope you are doing well",
        "please do not hesitate",
        "do not hesitate to reach out",
        "at your earliest convenience",
        "thank you for your cooperation",
        "thank you for your prompt attention",
        "we appreciate your continued",
        "rest assured",
        "kindly",
        "we understand this may be",
        "this is a gentle reminder",
        "for your convenience",
        "should you have any questions",
        "we are committed to",
        "as part of our ongoing efforts",
    ],
}

FEATURE_KEYS = [
    "n_chars",
    "n_words",
    "n_sentences",
    "avg_sentence_words",
    "std_sentence_words",
    "burstiness",
    "type_token_ratio",
    "avg_word_length",
    "uppercase_ratio",
    "digit_ratio",
    "punctuation_ratio",
    "exclaim_count",
    "question_count",
    "newline_count",
    "email_address_count",
    "has_html",
    "lex_credential_hits",
    "lex_credential_rate",
    "lex_urgency_hits",
    "lex_urgency_rate",
    "lex_threat_hits",
    "lex_threat_rate",
    "lex_authority_hits",
    "lex_authority_rate",
    "lex_reward_hits",
    "lex_reward_rate",
    "lex_cta_hits",
    "lex_cta_rate",
    "lex_generic_greeting_hits",
    "lex_generic_greeting_rate",
    "lex_ai_phrases_hits",
    "lex_ai_phrases_rate",
]

FEATURE_NAMES = FEATURE_KEYS + URL_FEATURE_KEYS

FEATURE_LABELS = {
    "n_chars": "message length",
    "n_words": "word count",
    "n_sentences": "sentence count",
    "avg_sentence_words": "sentence length",
    "std_sentence_words": "sentence-length variation",
    "burstiness": "uniform sentence rhythm",
    "type_token_ratio": "vocabulary variety",
    "avg_word_length": "average word length",
    "uppercase_ratio": "SHOUTING capitals",
    "digit_ratio": "unusual digit density",
    "punctuation_ratio": "heavy punctuation",
    "exclaim_count": "exclamation marks",
    "question_count": "rhetorical questions",
    "newline_count": "line-break structure",
    "email_address_count": "embedded email addresses",
    "has_html": "HTML content",
    "lex_credential_hits": "credential-request language",
    "lex_credential_rate": "credential-request density",
    "lex_urgency_hits": "urgency language",
    "lex_urgency_rate": "urgency density",
    "lex_threat_hits": "threat language",
    "lex_threat_rate": "threat density",
    "lex_authority_hits": "authority language",
    "lex_authority_rate": "authority density",
    "lex_reward_hits": "reward or prize language",
    "lex_reward_rate": "reward density",
    "lex_cta_hits": "call-to-action language",
    "lex_cta_rate": "call-to-action density",
    "lex_generic_greeting_hits": "generic greeting",
    "lex_generic_greeting_rate": "generic greeting density",
    "lex_ai_phrases_hits": "LLM-style stock phrases",
    "lex_ai_phrases_rate": "LLM phrase density",
    "url_count": "number of links",
    "url_max_points": "worst link risk",
    "url_total_points": "total link risk",
    "url_ip_count": "raw-IP links",
    "url_punycode_count": "punycode links",
    "url_shortener_count": "shortened links",
    "url_suspicious_tld_count": "high-abuse TLD links",
    "url_brand_count": "brand-look-alike links",
    "url_http_count": "unencrypted links",
    "url_at_count": "@-trick links",
    "url_max_length": "longest link",
    "url_max_host_length": "longest hostname",
    "url_max_entropy": "random-looking hostname",
    "url_max_subdomains": "deepest subdomain stack",
    "url_max_hyphens": "hyphens in hostname",
}

_WORD_RE = re.compile(r"[A-Za-z']+")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n{2,}")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")


def _count_terms(lower: str, terms: list[str]) -> int:
    total = 0
    for term in terms:
        if " " in term:
            total += lower.count(term)
        else:
            total += len(re.findall(rf"\b{re.escape(term)}\b", lower))
    return total


def _sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_RE.split(text) if len(p.strip()) > 3]
    return parts or ([text.strip()] if text.strip() else [])


def extract_features(text: str) -> dict[str, float]:
    text = text or ""
    lower = text.lower()
    words = _WORD_RE.findall(lower)
    sentences = _sentences(text)
    sentence_lengths = [len(_WORD_RE.findall(s)) for s in sentences] or [0]

    n_words = len(words)
    n_sentences = len(sentences)
    mean_len = sum(sentence_lengths) / max(1, len(sentence_lengths))
    variance = sum((x - mean_len) ** 2 for x in sentence_lengths) / max(
        1, len(sentence_lengths)
    )
    std_len = variance**0.5
    burstiness = (std_len / mean_len) if mean_len else 0.0

    unique_ratio = len(set(words[:300])) / max(1, min(len(words), 300))
    alpha_chars = [c for c in text if c.isalpha()]
    uppercase_ratio = (
        sum(c.isupper() for c in alpha_chars) / len(alpha_chars)
        if alpha_chars
        else 0.0
    )

    feats: dict[str, float] = {
        "n_chars": float(len(text)),
        "n_words": float(n_words),
        "n_sentences": float(n_sentences),
        "avg_sentence_words": float(mean_len),
        "std_sentence_words": float(std_len),
        "burstiness": float(burstiness),
        "type_token_ratio": float(unique_ratio),
        "avg_word_length": float(sum(map(len, words)) / max(1, n_words)),
        "uppercase_ratio": float(uppercase_ratio),
        "digit_ratio": float(sum(c.isdigit() for c in text) / max(1, len(text))),
        "punctuation_ratio": float(
            sum(not c.isalnum() and not c.isspace() for c in text) / max(1, len(text))
        ),
        "exclaim_count": float(text.count("!")),
        "question_count": float(text.count("?")),
        "newline_count": float(text.count("\n")),
        "email_address_count": float(len(_EMAIL_RE.findall(text))),
        "has_html": float(bool(re.search(r"(?i)<(?:html|body|a\s|div|table)\b", text))),
    }

    for category, terms in LEXICONS.items():
        hits = float(_count_terms(lower, terms))
        feats[f"lex_{category}_hits"] = hits
        feats[f"lex_{category}_rate"] = float(hits * 100.0 / max(1, n_words))

    feats.update(url_features(extract_urls(text)))
    return feats


def rule_signals(feats: dict[str, float]) -> list[dict]:
    """Turn intent features into weighted, human-readable signals."""
    signals: list[dict] = []

    def add(key: str, label: str, weight: float, detail: str) -> None:
        if weight <= 0:
            return
        signals.append(
            {
                "key": key,
                "category": "content",
                "label": label,
                "weight": round(float(weight), 2),
                "detail": detail,
            }
        )

    cred = feats.get("lex_credential_hits", 0)
    if cred >= 2:
        add("credential", "Requests credentials or payment data", 3.0, f"{int(cred)} credential-related phrases found")
    elif cred >= 1:
        add("credential", "Mentions account verification", 1.5, "1 credential-related phrase found")

    urgency = feats.get("lex_urgency_hits", 0)
    if urgency >= 2:
        add("urgency", "Creates artificial urgency", 2.0, f"{int(urgency)} urgency phrases found")
    elif urgency >= 1:
        add("urgency", "Mild urgency language", 1.0, "1 urgency phrase found")

    threat = feats.get("lex_threat_hits", 0)
    if threat >= 2:
        add("threat", "Threatens account loss or suspension", 2.0, f"{int(threat)} threat phrases found")
    elif threat >= 1:
        add("threat", "Hints at account consequences", 1.0, "1 threat phrase found")

    reward = feats.get("lex_reward_hits", 0)
    if reward >= 2:
        add("reward", "Promises a prize, refund or reward", 1.5, f"{int(reward)} reward phrases found")
    elif reward >= 1:
        add("reward", "Mentions a reward or refund", 0.75, "1 reward phrase found")

    cta = feats.get("lex_cta_hits", 0)
    if cta >= 2:
        add("cta", "Pushes a specific click or download action", 1.0, f"{int(cta)} calls to action")
    elif cta >= 1:
        add("cta", "Contains a call to action", 0.5, "1 call to action")

    greeting = feats.get("lex_generic_greeting_hits", 0)
    if greeting >= 1:
        add("generic_greeting", "Uses a generic greeting instead of your name", 0.75, "No personal salutation")

    ai_phrases = feats.get("lex_ai_phrases_hits", 0)
    if ai_phrases >= 2:
        add("ai_phrases", "Uses polished LLM-style stock phrases", 0.75, f"{int(ai_phrases)} stock phrases found")
    elif ai_phrases >= 1:
        add("ai_phrases", "Mild LLM-style phrasing", 0.35, "1 stock phrase found")

    url_points = feats.get("url_total_points", 0)
    if url_points:
        add("urls", "Contains links with risky structure", min(4.0, url_points / 2.0), f"{int(feats.get('url_count', 0))} link(s) scored by URL rules")

    if feats.get("uppercase_ratio", 0) > 0.18:
        add("caps", "Uses excessive capitals", 0.5, "More than 18% of letters are uppercase")
    if feats.get("exclaim_count", 0) >= 3:
        add("exclaim", "Uses repeated exclamation marks", 0.5, f"{int(feats['exclaim_count'])} exclamation marks")
    if feats.get("has_html", 0):
        add("html", "Contains HTML markup", 0.25, "HTML email body detected")

    return signals


def handcrafted_vector(text: str) -> list[float]:
    feats = extract_features(text)
    return [float(feats.get(key, 0.0)) for key in FEATURE_NAMES]
