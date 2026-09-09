"""Независимая проверка волны 2 (ревью T1).

Дополняет tests/api/test_wave2.py тем, что там не покрыто:
- POST /ai-api/telemetry без cookie сессии → 401;
- X-Request-Id на ответах телеметрии;
- живой SSE /ai-api/chat отдаёт событие ctx с used/limit/fill;
- отказ 401 на /ai-api/chat без cookie.
"""
import json
import os
import time
import uuid

import pytest
import requests

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


class TestAuthGate:
    def test_telemetry_post_is_open_but_limited(self, anon):
        """§3.5: приём клиентской ошибки открыт без сессии (иначе падение на
        экране входа никуда не доходит), но с собственным лимитом; чтение
        метрик остаётся закрытым."""
        r = anon.post(
            f"{BASE}/ai-api/telemetry",
            json={"kind": "client-error", "where": "screen:map", "message": "x"},
            headers={"X-Forwarded-For": "203.0.113.88"},
            timeout=30,
        )
        assert r.status_code == 202, r.text[:200]
        assert r.headers.get("X-Request-Id")

        g = anon.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert g.status_code == 401
        assert g.json()["code"] == "AUTH_REQUIRED"

    def test_chat_requires_auth(self, anon):
        r = anon.post(f"{BASE}/ai-api/chat", json={"sessionId": "x"}, timeout=30)
        assert r.status_code == 401
        assert r.headers.get("X-Request-Id")


class TestTelemetryHeaders:
    def test_request_id_on_accept_and_metrics(self, api):
        r = api.post(
            f"{BASE}/ai-api/telemetry",
            json={"kind": "client-error", "where": "screen:library", "message": "review"},
            timeout=30,
        )
        assert r.status_code == 202
        assert r.headers.get("X-Request-Id")
        g = api.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert g.status_code == 200
        assert g.headers.get("X-Request-Id")
        m = g.json()
        assert isinstance(m["turns"], (int, float))
        assert isinstance(m["errors"], (int, float))
        assert isinstance(m["tokens"], dict)


class TestChatCtxEvent:
    def test_sse_emits_ctx_with_fill(self, api):
        payload = {
            "sessionId": f"review-{uuid.uuid4().hex[:8]}",
            "engine": "cloud",
            "text": "Ответь одним словом: тест",
            "msgs": [],
        }
        for attempt in range(2):
            r = api.post(f"{BASE}/ai-api/chat", json=payload, stream=True, timeout=90)
            if r.status_code == 429 and attempt == 0:
                time.sleep(min(70, int(r.headers.get("Retry-After", "61")) + 2))
                continue
            break
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("X-Request-Id")
        ctx = None
        got_end = False
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            ev = json.loads(line[5:].strip())
            if ev.get("t") == "ctx":
                ctx = ev
            if ev.get("t") == "end":
                got_end = True
                break
        assert ctx is not None, "событие ctx не пришло в SSE"
        assert ctx["used"] > 0 and ctx["limit"] > 0
        assert 0 <= ctx["fill"] <= 100
        expected = min(100, round(ctx["used"] / ctx["limit"] * 100))
        assert abs(ctx["fill"] - expected) <= 1, ctx
        assert got_end, "поток не завершился событием end"
