from fastapi.testclient import TestClient

from phishingan.api import app


def test_health_and_samples():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        samples = client.get("/api/samples")
        assert samples.status_code == 200
        assert len(samples.json()["samples"]) >= 4


def test_scan_endpoint_returns_structured_result():
    with TestClient(app) as client:
        response = client.post(
            "/api/scan",
            json={"text": "Dear Customer, verify your password immediately at http://192.0.2.44/login"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["verdict"] in {"phishing", "suspicious", "legitimate"}
        assert "reasons" in body
        assert "urls" in body
        assert body["urls"][0]["defanged"].startswith("hxxp://")


def test_scan_rejects_short_input():
    with TestClient(app) as client:
        response = client.post("/api/scan", json={"text": "short"})
        assert response.status_code == 422


def test_index_is_served():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "PhishinGAN" in response.text
