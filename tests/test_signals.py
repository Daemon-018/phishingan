from phishingan.features.signals import (
    FEATURE_NAMES,
    extract_features,
    handcrafted_vector,
    rule_signals,
)

PHISH = (
    "Dear Customer, we detected unauthorized activity. Your account will be "
    "suspended immediately unless you verify your password and card number. "
    "Click here: http://192.0.2.44/login"
)
LEGIT = (
    "Hi Priya, thanks for the design notes. I will review the wireframes before "
    "Friday and send comments. No rush if something comes up."
)


def test_feature_dict_has_every_declared_key():
    feats = extract_features(PHISH)
    assert set(feats) == set(FEATURE_NAMES)
    assert all(isinstance(value, (int, float)) for value in feats.values())


def test_phishing_language_scores_higher_than_small_talk():
    phish = extract_features(PHISH)
    legit = extract_features(LEGIT)
    assert phish["lex_credential_hits"] > legit["lex_credential_hits"]
    assert phish["lex_threat_hits"] > legit["lex_threat_hits"]
    assert phish["url_total_points"] > legit["url_total_points"]


def test_rule_signals_fire_for_phishing_and_stay_quiet_for_legit():
    phish_rules = rule_signals(extract_features(PHISH))
    legit_rules = rule_signals(extract_features(LEGIT))
    assert sum(rule["weight"] for rule in phish_rules) >= 3
    assert sum(rule["weight"] for rule in legit_rules) == 0
    assert any(rule["key"] == "credential" for rule in phish_rules)


def test_handcrafted_vector_length_is_stable():
    assert len(handcrafted_vector("")) == len(FEATURE_NAMES)
    assert len(handcrafted_vector(PHISH)) == len(FEATURE_NAMES)


def test_empty_text_is_finite():
    feats = extract_features("")
    assert feats["n_words"] == 0
    assert feats["burstiness"] == 0
