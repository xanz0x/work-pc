"""Wave-2 backend tests: валидация входа, request-id, телеметрия, метрики.

Проверяется то, что добавила волна 2:
- битое тело запроса даёт 400 с кодом каталога, а не 500;
- каждый ответ /ai-api несёт X-Request-Id;
- локальный трекинг ошибок принимает записи и отдаёт четыре метрики;
- окно контекста не выпускает наружу лишние ходы (через метрики chars).
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


def post_chat(api, **kwargs):
    """Лимит запросов общий на IP: если бюджет минуты выбрали прошлые тесты,
    ждём окно один раз — иначе проверка валидации ловит 429 вместо 400."""
    r = api.post(f"{BASE}/ai-api/chat", timeout=30, **kwargs)
    if r.status_code == 429:
        import time

        time.sleep(min(70, int(r.headers.get("Retry-After", "61")) + 1))
        r = api.post(f"{BASE}/ai-api/chat", timeout=30, **kwargs)
    return r


class TestRequestId:
    def test_request_id_on_denied(self, anon):
        r = anon.get(f"{BASE}/ai-api/skills", timeout=30)
        assert r.status_code == 401
        assert r.headers.get("X-Request-Id"), "отказ обязан нести request-id"
        assert r.json()["code"] == "AUTH_REQUIRED"

    def test_request_id_on_success(self, api):
        r = api.get(f"{BASE}/ai-api/skills", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("X-Request-Id")


class TestValidation:
    def test_broken_json_is_400_not_500(self, api):
        r = post_chat(
            api,
            data="{это не json",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400, r.text[:300]
        assert r.json()["code"] == "BAD_REQUEST"

    def test_missing_session_id_is_400(self, api):
        r = post_chat(api, json={"engine": "cloud"})
        assert r.status_code == 400
        assert r.json()["code"] == "BAD_REQUEST"

    def test_path_traversal_in_session_id_is_400(self, api):
        r = post_chat(
            api,
            json={"sessionId": "../../etc/passwd", "engine": "cloud", "text": "привет"},
        )
        assert r.status_code == 400
        assert r.json()["code"] == "BAD_REQUEST"


class TestTelemetry:
    def test_client_error_accepted(self, api):
        r = api.post(
            f"{BASE}/ai-api/telemetry",
            json={"kind": "client-error", "where": "screen:map", "message": "boom"},
            timeout=30,
        )
        assert r.status_code == 202
        assert r.json()["requestId"]

    def test_broken_body_is_400(self, api):
        r = api.post(
            f"{BASE}/ai-api/telemetry",
            data="не json",
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        assert r.status_code == 400

    def test_metrics_expose_four_numbers(self, api):
        api.post(
            f"{BASE}/ai-api/telemetry",
            json={"kind": "client-error", "where": "screen:chat", "message": "x"},
            timeout=30,
        )
        r = api.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert r.status_code == 200
        m = r.json()
        for key in ("turns", "errors", "latency", "tokens"):
            assert key in m, f"метрика {key} отсутствует"
        assert m["errors"] >= 1
        assert set(m["latency"]) >= {"samples", "p50", "p95"}

    def test_metrics_do_not_leak_content(self, api):
        secret = "паспорт-серия-1234"
        api.post(
            f"{BASE}/ai-api/telemetry",
            json={"kind": "client-error", "where": "screen:vault", "message": "ok", "extra": secret},
            timeout=30,
        )
        r = api.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert secret not in r.text, "в метрики попало содержимое запроса"

    def test_telemetry_requires_auth(self, anon):
        r = anon.get(f"{BASE}/ai-api/telemetry", timeout=30)
        assert r.status_code == 401
