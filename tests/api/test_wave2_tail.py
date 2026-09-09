"""Хвост волны 2: лимитер, доступ к телеметрии, автосев AI_DIR.

Проверяется то, что доделано после закрытия пяти задач волны:
- §3.4 бюджет лимита не тратится на тела, отвергнутые разбором (400);
- §3.5 приём клиентской ошибки открыт без сессии, чтение метрик — нет;
- телеметрия имеет собственный лимит на адрес;
- §4.3 каталог скиллов засевается при старте (иначе после сброса пода 404).
"""
import os
import requests
import pytest

BASE = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"вход не удался: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


class TestRateBudget:
    def test_broken_json_does_not_spend_budget(self, api):
        """20 битых тел подряд: все обязаны получить 400, а не 429."""
        headers = {"X-Forwarded-For": "203.0.113.33"}
        codes = []
        for _ in range(20):
            r = api.post(
                f"{BASE}/ai-api/chat",
                data="{это не json",
                headers={"Content-Type": "application/json", **headers},
                timeout=30,
            )
            codes.append(r.status_code)
        assert set(codes) == {400}, f"бюджет тратится на битые тела: {codes}"

    def test_valid_shape_still_limited(self, api):
        """Разобранное тело считается ходом — иначе лимит бесполезен."""
        headers = {"X-Forwarded-For": "203.0.113.44"}
        codes = []
        for _ in range(12):
            r = api.post(
                f"{BASE}/ai-api/chat",
                json={"engine": "local", "messages": []},
                headers=headers,
                timeout=30,
            )
            codes.append(r.status_code)
            if r.status_code == 429:
                break
        assert 429 in codes, f"лимит не сработал: {codes}"


class TestTelemetryAccess:
    def test_anonymous_post_accepted(self, anon):
        r = anon.post(
            f"{BASE}/ai-api/telemetry",
            json={"kind": "client-error", "where": "screen:login", "message": "e2e-anon"},
            headers={"X-Forwarded-For": "203.0.113.55"},
            timeout=30,
        )
        assert r.status_code == 202, r.text[:200]
        assert r.json()["ok"] is True

    def test_anonymous_get_is_denied(self, anon):
        r = anon.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert r.status_code == 401
        assert r.json()["code"] == "AUTH_REQUIRED"

    def test_metrics_readable_with_session(self, api):
        r = api.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert r.status_code == 200
        body = r.json()
        for field in ("turns", "errors", "latency", "recentErrors"):
            assert field in body

    def test_telemetry_has_its_own_limit(self, anon):
        headers = {"X-Forwarded-For": "203.0.113.66"}
        codes = []
        for i in range(35):
            r = anon.post(
                f"{BASE}/ai-api/telemetry",
                json={"kind": "client-error", "where": "screen:x", "message": f"e2e-{i}"},
                headers=headers,
                timeout=30,
            )
            codes.append(r.status_code)
            if r.status_code == 429:
                assert r.headers.get("Retry-After") is not None
                break
        assert 429 in codes, f"телеметрия без лимита: {codes[-5:]}"

    def test_client_error_reaches_metrics(self, api):
        marker = "e2e-marker-телеметрия"
        api.post(
            f"{BASE}/ai-api/telemetry",
            json={"kind": "client-error", "where": "screen:library", "message": marker},
            headers={"X-Forwarded-For": "203.0.113.77"},
            timeout=30,
        )
        r = api.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert r.status_code == 200
        recent = r.json()["recentErrors"]
        assert any(marker in rec.get("reason", "") for rec in recent), recent[:3]


class TestAiDirSeed:
    def test_skills_present_after_boot(self, api):
        """§4.3: каталог AI_DIR засевается при старте — 404 больше не ждём."""
        r = api.get(f"{BASE}/ai-api/skills", timeout=30)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        items = body if isinstance(body, list) else body.get("skills", [])
        ids = {s.get("id") for s in items}
        assert "find-file" in ids, ids

    def test_mcp_present_after_boot(self, api):
        r = api.get(f"{BASE}/ai-api/mcp", timeout=30)
        assert r.status_code == 200, r.text[:200]
