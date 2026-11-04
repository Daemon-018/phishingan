from phishingan.features.urls import (
    URL_FEATURE_KEYS,
    analyze_url,
    defang,
    extract_urls,
    url_features,
)

PHISH = (
    "Dear Customer, your account will be suspended. Verify your password at "
    "http://192.0.2.44/login and https://paypa1.com/secure"
)


def test_extract_urls_ignores_email_addresses():
    urls = extract_urls("Mail alice@example.com or open https://example.org/login now.")
    assert urls == ["https://example.org/login"]


def test_extract_urls_supports_bare_domains_and_dedupes():
    urls = extract_urls("See example.com/a and http://example.com/a and example.com/a")
    assert len(urls) == 2


def test_ip_host_is_flagged():
    info = analyze_url("http://192.0.2.44/login")
    assert info["features"]["is_ip"] == 1
    assert info["points"] >= 3
    assert any(flag["code"] == "ip_host" for flag in info["flags"])


def test_punycode_and_shortener_are_flagged():
    puny = analyze_url("https://xn--pypal-4ve.com/login")
    short = analyze_url("https://bit.ly/abc123")
    assert puny["features"]["is_punycode"] == 1
    assert short["features"]["is_shortener"] == 1


def test_brand_lookalike_is_flagged():
    info = analyze_url("https://paypa1.com/verify")
    assert info["features"]["has_brand"] == 1
    assert any(flag["code"] == "brand" for flag in info["flags"])


def test_suspicious_tld_is_flagged():
    info = analyze_url("https://account-review.top/verify")
    assert info["features"]["is_suspicious_tld"] == 1


def test_defang_removes_live_scheme_and_dots():
    assert defang("https://a.example.com/x") == "hxxps://a[.]example[.]com/x"


def test_url_features_has_stable_keys():
    empty = url_features([])
    assert set(empty) == set(URL_FEATURE_KEYS)
    assert empty["url_count"] == 0

    populated = url_features(extract_urls(PHISH))
    assert populated["url_count"] == 2
    assert populated["url_ip_count"] == 1
    assert populated["url_brand_count"] == 1
    assert populated["url_max_points"] >= 3
