"""Независимая перепроверка хвоста волны 2 (QA-агент T1).

Покрывается ровно то, что просил заказчик проверки:
- регресс входа и 401 AUTH_REQUIRED с X-Request-Id;
- §3.4 битые тела не тратят бюджет лимитера;
- лимитер продолжает работать: 429 + Retry-After + code RATE_LIMITED;
- §3.5 телеметрия: POST открыт (202), GET закрыт (401), метрики с cookie;
- собственный лимит телеметрии;
- §4.3 автосев AI_DIR (skills/mcp).
"""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")
T = 40


def ip(suffix: str) -> dict:
    """Свой адрес на каждую проверку, чтобы окна лимитера не пересекались."""
    return {"X-Forwarded-For": suffix}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD},
               headers=ip("198.51.100.1"), timeout=T)
    assert r.status_code == 200, f"вход не удался: {r.status_code} {r.text[:300]}"
    assert "wf_session" in s.cookies.get_dict(), s.cookies.get_dict()
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ---------- вход / гейт ----------
class TestAuthRegression:
    def test_login_bad_password_rejected(self, anon):
        r = anon.post(f"{BASE}/ai-api/auth/login", json={"password": "не тот пароль"},
                      headers=ip("198.51.100.2"), timeout=T)
        assert r.status_code == 401, r.text[:300]
        assert "wf_session" not in r.cookies.get_dict()

    def test_skills_denied_without_cookie(self, anon):
        r = anon.get(f"{BASE}/ai-api/skills", timeout=T)
        assert r.status_code == 401
        assert r.json().get("code") == "AUTH_REQUIRED"
        assert r.headers.get("X-Request-Id"), dict(r.headers)

    def test_session_endpoint_with_cookie(self, api):
        r = api.get(f"{BASE}/ai-api/auth/session", timeout=T)
        assert r.status_code == 200, r.text[:300]


# ---------- §3.4 лимитер ----------
class TestRateLimiter:
    def test_broken_bodies_never_429(self, api):
        codes = []
        for _ in range(20):
            r = api.post(f"{BASE}/ai-api/chat", data="{битое тело",
                         headers={"Content-Type": "application/json", **ip("198.51.100.10")},
                         timeout=T)
            codes.append(r.status_code)
        assert set(codes) == {400}, f"бюджет тратится на неразобранные тела: {codes}"

    def test_valid_bodies_hit_limit(self, api):
        codes, limited = [], None
        for _ in range(12):
            r = api.post(f"{BASE}/ai-api/chat", json={"engine": "local", "messages": []},
                         headers=ip("198.51.100.11"), timeout=T)
            codes.append(r.status_code)
            if r.status_code == 429:
                limited = r
                break
        assert limited is not None, f"лимит не сработал: {codes}"
        assert limited.json().get("code") == "RATE_LIMITED", limited.text[:300]
        assert limited.headers.get("Retry-After"), dict(limited.headers)


# ---------- §3.5 телеметрия ----------
class TestTelemetry:
    def test_post_open_without_cookie(self, anon):
        r = anon.post(f"{BASE}/ai-api/telemetry",
                      json={"kind": "client-error", "where": "screen:login", "message": "qa-open"},
                      headers=ip("198.51.100.20"), timeout=T)
        assert r.status_code == 202, r.text[:300]

    def test_get_requires_cookie(self, anon):
        r = anon.get(f"{BASE}/ai-api/telemetry", timeout=T)
        assert r.status_code == 401
        assert r.json().get("code") == "AUTH_REQUIRED"

    def test_metrics_shape_and_marker(self, api):
        marker = f"qa-маркер-{uuid.uuid4().hex[:8]}"
        p = api.post(f"{BASE}/ai-api/telemetry",
                     json={"kind": "client-error", "where": "screen:library", "message": marker},
                     headers=ip("198.51.100.21"), timeout=T)
        assert p.status_code == 202, p.text[:300]
        r = api.get(f"{BASE}/ai-api/telemetry", timeout=T)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        for field in ("turns", "errors", "latency", "recentErrors"):
            assert field in body, body.keys()
        blob = str(body["recentErrors"])
        assert marker in blob, blob[:400]

    def test_own_limit(self, anon):
        hit = None
        for i in range(35):
            r = anon.post(f"{BASE}/ai-api/telemetry",
                          json={"kind": "client-error", "where": "screen:x", "message": f"qa-{i}"},
                          headers=ip("198.51.100.22"), timeout=T)
            if r.status_code == 429:
                hit = r
                break
            assert r.status_code == 202, f"#{i}: {r.status_code} {r.text[:200]}"
        assert hit is not None, "телеметрия без лимита"
        assert hit.headers.get("Retry-After"), dict(hit.headers)


# ---------- §4.3 автосев ----------
class TestAiDirSeed:
    def test_skills_has_find_file(self, api):
        r = api.get(f"{BASE}/ai-api/skills", timeout=T)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        items = body if isinstance(body, list) else body.get("skills", [])
        ids = {s.get("id") for s in items}
        assert "find-file" in ids, ids

    def test_mcp_ok(self, api):
        r = api.get(f"{BASE}/ai-api/mcp", timeout=T)
        assert r.status_code == 200, r.text[:300]
