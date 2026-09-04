"""Модуль «Почта» — фаза 3: ВРЕМЕННАЯ почта (mail.tm бесплатно, SmailPro без ключа → 503 NO_KEY).

Прогон: APP_URL=https://compose-speedup.preview.emergentagent.com \
        python3 -m pytest tests/api/test_mail_temp.py -q
"""
import os

import pytest
import requests

BASE = os.environ.get("APP_URL", "https://compose-speedup.preview.emergentagent.com").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")
T = f"{BASE}/ai-api/mail/temp"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"login": "admin", "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def created(admin):
    """Один бесплатный ящик mail.tm на весь модуль, удаляется в конце."""
    r = admin.post(T, json={"kind": "mailtm"}, timeout=90)
    assert r.status_code == 201, f"{r.status_code} {r.text}"
    box = r.json()["box"]
    yield box
    admin.delete(f"{T}/{box['id']}", timeout=30)


# ---------- список и создание ----------

def test_list_requires_no_key_and_reports_smailpro_off(admin):
    r = admin.get(T, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data.get("boxes"), list)
    assert data.get("smailpro") is False, "SONJJ_API_KEY на сервере нет → smailpro должен быть false"


def test_create_mailtm_box(admin, created):
    assert isinstance(created["id"], str) and len(created["id"]) == 8
    assert "@" in created["address"], created
    assert created["kind"] == "mailtm"
    assert "password" not in created and "secret" not in created, "секреты не должны утекать в API"
    boxes = admin.get(T, timeout=30).json()["boxes"]
    assert any(b["id"] == created["id"] and b["address"] == created["address"] for b in boxes), "ящик не попал в список"


@pytest.mark.parametrize("kind", ["temp", "gmail", "outlook"])
def test_paid_kinds_return_503_no_key(admin, kind):
    r = admin.post(T, json={"kind": kind}, timeout=30)
    assert r.status_code == 503, f"{kind}: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("code") == "NO_KEY", data
    assert "SONJJ_API_KEY" in (data.get("error") or ""), data


def test_create_invalid_kind(admin):
    r = admin.post(T, json={"kind": "мусор-42"}, timeout=30)
    assert r.status_code == 400, r.text
    assert r.json().get("code") == "INVALID_ARGS"


def test_create_empty_body(admin):
    r = admin.post(T, data="not-json", headers={"content-type": "application/json"}, timeout=30)
    assert r.status_code == 400, r.text
    assert r.json().get("code") == "INVALID_ARGS"


# ---------- inbox / письмо / продление ----------

def test_inbox_contract(admin, created):
    r = admin.get(f"{T}/{created['id']}/inbox", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data.get("rows"), list)
    assert data["box"]["id"] == created["id"]
    assert isinstance(data.get("syncedAt"), int)
    assert data["box"].get("lastSyncAt"), "lastSyncAt должен обновляться"


def test_message_unknown_mid_404(admin, created):
    r = admin.get(f"{T}/{created['id']}/messages/does-not-exist-42", timeout=60)
    assert r.status_code == 404, f"{r.status_code} {r.text}"
    assert r.json().get("code") == "NOT_FOUND"


def test_extend_mailtm_not_supported(admin, created):
    r = admin.patch(f"{T}/{created['id']}", timeout=30)
    assert r.status_code == 400, r.text
    assert r.json().get("code") == "NOT_SUPPORTED"


def test_unknown_box_404(admin):
    for path in ("", "/inbox"):
        r = admin.get(f"{T}/00000000{path}", timeout=30) if path else admin.patch(f"{T}/00000000", timeout=30)
        assert r.status_code == 404, f"{path}: {r.status_code} {r.text}"
        assert r.json().get("code") == "NOT_FOUND"
    r = admin.delete(f"{T}/00000000", timeout=30)
    assert r.status_code == 404 and r.json().get("code") == "NOT_FOUND", r.text


def test_bad_id_shape_404(admin):
    r = admin.get(f"{T}/ZZZZ/inbox", timeout=30)
    assert r.status_code == 404, r.text
    assert r.json().get("code") == "NOT_FOUND"


# ---------- удаление ----------

def test_delete_box_and_repeat_404(admin):
    r = admin.post(T, json={"kind": "mailtm"}, timeout=90)
    assert r.status_code == 201, r.text
    box = r.json()["box"]
    d = admin.delete(f"{T}/{box['id']}", timeout=30)
    assert d.status_code == 200 and d.json().get("ok") is True, d.text
    boxes = admin.get(T, timeout=30).json()["boxes"]
    assert all(b["id"] != box["id"] for b in boxes), "ящик остался в списке после удаления"
    again = admin.delete(f"{T}/{box['id']}", timeout=30)
    assert again.status_code == 404, again.text
    assert again.json().get("code") == "NOT_FOUND"


# ---------- сессия ----------

def test_anonymous_requests_401(created):
    anon = requests.Session()
    checks = [
        ("get", T),
        ("post", T),
        ("get", f"{T}/{created['id']}/inbox"),
        ("get", f"{T}/{created['id']}/messages/x"),
        ("patch", f"{T}/{created['id']}"),
        ("delete", f"{T}/{created['id']}"),
    ]
    for method, url in checks:
        r = getattr(anon, method)(url, timeout=30)
        assert r.status_code == 401, f"{method} {url} → {r.status_code} {r.text[:200]}"
        assert r.json().get("code") == "AUTH_REQUIRED"


# ---------- лимит 60/мин (последний: съедает бюджет минуты) ----------

@pytest.mark.skipif(not os.environ.get("RUN_TEMP_RATE_LIMIT"), reason="RUN_TEMP_RATE_LIMIT=1 чтобы проверить лимит")
def test_rate_limit_429(admin):
    for i in range(70):
        r = admin.get(T, timeout=20)
        if r.status_code == 429:
            data = r.json()
            assert data["code"] == "RATE_LIMITED", data
            assert isinstance(data.get("retryAfter"), int) and data["retryAfter"] > 0, data
            assert i + 1 > 55, f"лимит сработал слишком рано: {i + 1}"
            return
    pytest.fail("429 не пришёл после 70 запросов")
