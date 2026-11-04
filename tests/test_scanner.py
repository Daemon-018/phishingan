import pytest

from phishingan.scanner import Scanner
from phishingan.samples import get_samples

PHISH = (
    "Subject: Action Required\nFrom: Security <security@account-review.top>\n\n"
    "Dear Valued Customer, I hope this email finds you well. We detected unusual "
    "activity. To avoid suspension, verify your password and card number within "
    "24 hours: https://secure-account-review.top/verify?session=8f3a91c2\n\n"
    "Please do not hesitate to reach out."
)
LEGIT = (
    "Subject: Notes from Tuesday's review\nFrom: Priya <priya@studio.example>\n\n"
    "Hi Arjun, thanks for joining. I attached the updated wireframes. Could you "
    "send comments by Friday? No rush."
)


@pytest.fixture()
def scanner():
    return Scanner(load_model=False)


def test_phishing_message_gets_a_high_risk_score(scanner):
    result = scanner.analyze(PHISH)
    assert result["verdict"] in {"phishing", "suspicious"}
    assert result["risk_score"] >= 40
    assert result["model"]["available"] is False
    assert result["reasons"]
    assert result["urls"]
    assert result["urls"][0]["defanged"].startswith("hxxps://")


def test_legitimate_message_stays_low(scanner):
    result = scanner.analyze(LEGIT)
    assert result["verdict"] == "legitimate"
    assert result["risk_score"] < 40


def test_short_message_is_rejected(scanner):
    with pytest.raises(ValueError):
        scanner.analyze("hi")


def test_samples_are_all_scannable(scanner):
    for sample in get_samples():
        result = scanner.analyze(sample["text"])
        assert 0 <= result["risk_score"] <= 100
        assert result["verdict"] in {"phishing", "suspicious", "legitimate"}
