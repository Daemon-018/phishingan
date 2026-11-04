"""URL extraction and lexical URL risk analysis.

Nothing here performs a network request. A URL is scored from its text alone:
host shape, encoding tricks, look-alike brands and suspicious TLDs.
"""

from __future__ import annotations

import ipaddress
import math
import re
from urllib.parse import urlsplit

TLD_PATTERN = (
    "com|net|org|io|co|ai|app|dev|info|biz|online|site|website|shop|store|"
    "xyz|top|club|live|icu|vip|work|link|click|support|help|finance|bank|"
    "secure|account|update|verify|zip|mov|cam|rest|fit|buzz|monster|quest|"
    "sbs|cfd|lgbt|gq|tk|ml|cf|ga|gov|edu|mil|int|us|uk|in|au|ca|de|fr|es|"
    "it|nl|ru|cn|jp|br|za|ae|sg|example"
)

URL_RE = re.compile(
    r"""(?ix)
    (?:
        https?://[^\s<>"')\]]+
      | www\.[^\s<>"')\]]+
      | (?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:"""
    + TLD_PATTERN
    + r""")(?:/[^\s<>"')\]]*)?
    )
    """
)

TRAILING = ".,;:!?)]}\"'"

SHORTENERS = {
    "bit.ly",
    "t.co",
    "goo.gl",
    "tinyurl.com",
    "ow.ly",
    "is.gd",
    "buff.ly",
    "cutt.ly",
    "rb.gy",
    "shorturl.at",
    "rebrand.ly",
    "tiny.cc",
    "lnkd.in",
    "trib.al",
    "bl.ink",
}

SUSPICIOUS_TLDS = {
    "zip",
    "mov",
    "top",
    "xyz",
    "click",
    "link",
    "live",
    "icu",
    "cam",
    "rest",
    "fit",
    "buzz",
    "monster",
    "quest",
    "sbs",
    "cfd",
    "lgbt",
    "gq",
    "tk",
    "ml",
    "cf",
    "ga",
    "work",
    "support",
    "verify",
    "account",
    "update",
    "secure",
}

BRANDS = {
    "paypal",
    "apple",
    "icloud",
    "microsoft",
    "outlook",
    "google",
    "gmail",
    "amazon",
    "netflix",
    "facebook",
    "instagram",
    "whatsapp",
    "linkedin",
    "dropbox",
    "adobe",
    "coinbase",
    "binance",
    "steam",
    "spotify",
    "bankofamerica",
    "chase",
    "wellsfargo",
    "citibank",
    "hsbc",
    "dhl",
    "fedex",
    "usps",
    "irs",
    "hdfc",
    "icici",
    "sbi",
    "axis",
    "paytm",
    "phonepe",
}

# Official domains for the brands above. Used to avoid calling a real brand
# login page an impersonation (for example login.microsoftonline.com).
BRAND_DOMAINS = {
    "paypal": ["paypal.com", "paypal.me"],
    "apple": ["apple.com", "icloud.com"],
    "icloud": ["icloud.com", "apple.com"],
    "microsoft": [
        "microsoft.com",
        "microsoftonline.com",
        "live.com",
        "outlook.com",
        "office.com",
        "office365.com",
        "microsoft365.com",
    ],
    "outlook": ["outlook.com", "live.com", "microsoft.com"],
    "google": ["google.com", "gmail.com", "youtube.com"],
    "gmail": ["gmail.com", "google.com"],
    "amazon": [
        "amazon.com",
        "amazon.in",
        "amazon.co.uk",
        "amazon.de",
        "amazonaws.com",
    ],
    "netflix": ["netflix.com"],
    "facebook": ["facebook.com", "fb.com"],
    "instagram": ["instagram.com"],
    "whatsapp": ["whatsapp.com", "wa.me"],
    "linkedin": ["linkedin.com", "lnkd.in"],
    "dropbox": ["dropbox.com"],
    "adobe": ["adobe.com"],
    "coinbase": ["coinbase.com"],
    "binance": ["binance.com"],
    "steam": ["steamcommunity.com", "steampowered.com"],
    "spotify": ["spotify.com"],
    "bankofamerica": ["bankofamerica.com"],
    "chase": ["chase.com"],
    "wellsfargo": ["wellsfargo.com"],
    "citibank": ["citibank.com", "citi.com"],
    "hsbc": ["hsbc.com", "hsbc.co.uk"],
    "dhl": ["dhl.com"],
    "fedex": ["fedex.com"],
    "usps": ["usps.com"],
    "irs": ["irs.gov"],
    "hdfc": ["hdfcbank.com"],
    "icici": ["icicibank.com"],
    "sbi": ["sbi.co.in", "onlinesbi.com", "onlinesbi.sbi"],
    "axis": ["axisbank.com"],
    "paytm": ["paytm.com"],
    "phonepe": ["phonepe.com"],
}

# Common two-label public suffixes. A full public-suffix list is overkill for
# a lexical scorer; this covers the brands above.
MULTI_LABEL_SUFFIXES = {
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "co.in",
    "net.in",
    "org.in",
    "co.jp",
    "ne.jp",
    "or.jp",
    "com.au",
    "net.au",
    "org.au",
    "com.br",
    "com.mx",
    "com.sg",
    "com.hk",
    "com.tw",
    "co.za",
    "co.nz",
    "co.kr",
    "com.tr",
    "com.ar",
    "com.cn",
    "com.my",
    "co.id",
    "co.th",
    "com.ph",
    "com.vn",
    "com.pk",
    "com.sa",
    "com.eg",
}

URL_FEATURE_KEYS = [
    "url_count",
    "url_max_points",
    "url_total_points",
    "url_ip_count",
    "url_punycode_count",
    "url_shortener_count",
    "url_suspicious_tld_count",
    "url_brand_count",
    "url_http_count",
    "url_at_count",
    "url_max_length",
    "url_max_host_length",
    "url_max_entropy",
    "url_max_subdomains",
    "url_max_hyphens",
]


def defang(url: str) -> str:
    """Make a URL safe to display: no clickable scheme, no live dots."""
    safe = url.replace("https://", "hxxps://").replace("http://", "hxxp://")
    safe = safe.replace(".", "[.]").replace("@", "[@]")
    return safe


def extract_urls(text: str, limit: int = 20) -> list[str]:
    seen: set[str] = set()
    urls: list[str] = []
    for match in URL_RE.finditer(text or ""):
        url = match.group(0).rstrip(TRAILING)
        if len(url) < 4:
            continue
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        urls.append(url)
        if len(urls) >= limit:
            break
    return urls


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if abs(len(a) - len(b)) > 2:
        return 3
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            insert = current[j - 1] + 1
            delete = previous[j] + 1
            replace = previous[j - 1] + (ca != cb)
            current.append(min(insert, delete, replace))
        previous = current
    return previous[-1]


def _entropy(value: str) -> float:
    if not value:
        return 0.0
    counts: dict[str, int] = {}
    for char in value:
        counts[char] = counts.get(char, 0) + 1
    total = len(value)
    return -sum((n / total) * math.log2(n / total) for n in counts.values())


def _registrable_base(host: str) -> str:
    """Best-effort registrable label, e.g. login.paypal.com -> paypal."""
    labels = [label for label in host.split(".") if label]
    if len(labels) < 2:
        return labels[0] if labels else ""
    if len(labels) >= 3 and ".".join(labels[-2:]) in MULTI_LABEL_SUFFIXES:
        return labels[-3]
    return labels[-2]


def _owns_brand(host: str, brand: str) -> bool:
    domains = BRAND_DOMAINS.get(brand, [f"{brand}.com"])
    if any(host == domain or host.endswith("." + domain) for domain in domains):
        return True
    # google.co.in, paypal.de and similar country sites.
    return _registrable_base(host) == brand


def _brand_impersonation(host: str) -> str | None:
    labels = host.split(".")
    if len(labels) < 2:
        return None
    base = labels[-2]
    for brand in BRANDS:
        if _owns_brand(host, brand):
            continue
        if brand in host:
            return brand
        if abs(len(base) - len(brand)) <= 2 and _levenshtein(base, brand) <= 1:
            return brand
    return None


def analyze_url(raw: str) -> dict:
    """Return a dict describing one URL and the reasons it looks risky."""
    url = (raw or "").strip().rstrip(TRAILING)
    candidate = url if re.match(r"(?i)^https?://", url) else "http://" + url
    try:
        parts = urlsplit(candidate)
        host = (parts.hostname or "").lower().strip(".")
        port = parts.port
    except ValueError:
        parts = urlsplit("http://invalid")
        host = ""
        port = None

    scheme = (parts.scheme or "").lower()
    labels = [label for label in host.split(".") if label]
    tld = labels[-1] if labels else ""
    is_ip = False
    if host:
        try:
            ipaddress.ip_address(host)
            is_ip = True
        except ValueError:
            is_ip = False

    brand = _brand_impersonation(host) if host else None
    hyphens = host.count("-")
    subdomains = max(0, len(labels) - 2)
    entropy = _entropy(host)
    path = parts.path or ""

    flags: list[dict] = []

    def add(code: str, label: str, points: float) -> None:
        flags.append({"code": code, "label": label, "points": points})

    if is_ip:
        add("ip_host", "Link uses a raw IP address instead of a domain", 3.0)
    if "xn--" in host:
        add("punycode", "Link uses punycode, often used to fake a brand", 3.0)
    if host in SHORTENERS:
        add("shortener", "Link is hidden behind a URL shortener", 1.0)
    if tld in SUSPICIOUS_TLDS:
        add("tld", f"Link uses a high-abuse top-level domain (.{tld})", 2.0)
    if brand:
        add("brand", f"Link imitates the brand “{brand}”", 3.0)
    if "@" in url:
        add("userinfo", "Link contains an @ trick that hides the real host", 2.0)
    if port and port not in (80, 443):
        add("port", f"Link uses an unusual port ({port})", 1.0)
    if scheme == "http":
        add("plain_http", "Link is unencrypted HTTP", 0.5)
    if len(url) > 75:
        add("long_url", "Link is unusually long", 1.0)
    if len(host) > 30:
        add("long_host", "Link hostname is unusually long", 1.0)
    if subdomains >= 3:
        add("subdomains", "Link stacks many subdomains", 1.0)
    if hyphens >= 2:
        add("hyphens", "Link hostname contains several hyphens", 1.0)
    if len(re.findall(r"\d", host)) >= 4:
        add("digits", "Link hostname contains many digits", 1.0)
    if len(path) > 60:
        add("long_path", "Link path is unusually long or encoded", 0.5)

    points = min(8.0, sum(flag["points"] for flag in flags))
    return {
        "url": url,
        "defanged": defang(url),
        "host": host,
        "tld": tld,
        "points": round(points, 2),
        "flags": flags,
        "features": {
            "length": len(url),
            "host_length": len(host),
            "entropy": round(entropy, 3),
            "subdomains": subdomains,
            "hyphens": hyphens,
            "is_ip": int(is_ip),
            "is_punycode": int("xn--" in host),
            "is_shortener": int(host in SHORTENERS),
            "is_suspicious_tld": int(tld in SUSPICIOUS_TLDS),
            "has_brand": int(brand is not None),
            "is_http": int(scheme == "http"),
            "has_at": int("@" in url),
        },
    }


def url_features(urls: list[str]) -> dict[str, float]:
    """Aggregate URL-level signals into one flat feature dict."""
    infos = [analyze_url(url) for url in urls]
    zeros = {key: 0.0 for key in URL_FEATURE_KEYS}
    if not infos:
        zeros["url_count"] = 0.0
        return zeros
    return {
        "url_count": float(len(infos)),
        "url_max_points": max(info["points"] for info in infos),
        "url_total_points": float(sum(info["points"] for info in infos)),
        "url_ip_count": float(sum(i["features"]["is_ip"] for i in infos)),
        "url_punycode_count": float(sum(i["features"]["is_punycode"] for i in infos)),
        "url_shortener_count": float(sum(i["features"]["is_shortener"] for i in infos)),
        "url_suspicious_tld_count": float(
            sum(i["features"]["is_suspicious_tld"] for i in infos)
        ),
        "url_brand_count": float(sum(i["features"]["has_brand"] for i in infos)),
        "url_http_count": float(sum(i["features"]["is_http"] for i in infos)),
        "url_at_count": float(sum(i["features"]["has_at"] for i in infos)),
        "url_max_length": float(max(i["features"]["length"] for i in infos)),
        "url_max_host_length": float(max(i["features"]["host_length"] for i in infos)),
        "url_max_entropy": float(max(i["features"]["entropy"] for i in infos)),
        "url_max_subdomains": float(max(i["features"]["subdomains"] for i in infos)),
        "url_max_hyphens": float(max(i["features"]["hyphens"] for i in infos)),
    }
