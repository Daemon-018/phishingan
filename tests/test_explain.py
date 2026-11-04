from phishingan.explain import highlight_spans, lexicon_hits


def test_highlight_spans_do_not_overlap():
    text = "Dear Customer, verify your password and click here now."
    spans = highlight_spans(text, ["dear customer", "verify", "password", "click here", "customer"])
    assert spans
    for previous, current in zip(spans, spans[1:]):
        assert previous["end"] <= current["start"]


def test_highlight_spans_preserve_original_case():
    text = "URGENT: Verify your account."
    spans = highlight_spans(text, ["urgent", "verify"])
    assert [span["text"] for span in spans] == ["URGENT", "Verify"]


def test_lexicon_hits_find_intent_phrases():
    hits = lexicon_hits("Dear Customer, verify your password immediately or lose access.")
    terms = {hit["term"] for hit in hits}
    assert "verify" in terms
    assert "immediately" in terms
    assert "dear customer" in terms
