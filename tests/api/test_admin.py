"""Аккаунты и админ-панель: регистрация → лицензия → функции → блокировка → удаление.

Прогон: APP_URL=https://<preview> python3 -m pytest tests/api/test_admin.py -q
"""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")
EMAIL = f"user-{uuid.uuid4().hex[:6]}@test.local"
USER_PASS = "user-pass-12345"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "admin"
    return s


@pytest.fixture(scope="module")
def user():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/register", json={"email": EMAIL, "password": USER_PASS, "name": "Тест"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "user"
    return s


def test_register_validation():
    assert requests.post(f"{BASE}/ai-api/auth/register", json={"email": "bad", "password": USER_PASS}, timeout=15).status_code == 400
    assert requests.post(f"{BASE}/ai-api/auth/register", json={"email": "x@y.zz", "password": "short"}, timeout=15).status_code == 400


def test_new_user_needs_license(user):
    sess = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()
    assert sess["authed"] and sess["access"] == "license"
    r = user.get(f"{BASE}/ai-api/sessions", timeout=15)
    assert r.status_code == 403 and r.json()["code"] == "LICENSE_REQUIRED"
    assert user.get(f"{BASE}/admin/api/users", timeout=15).status_code == 403


def test_duplicate_email(user):
    r = requests.post(f"{BASE}/ai-api/auth/register", json={"email": EMAIL, "password": USER_PASS}, timeout=15)
    assert r.status_code == 409


def test_admin_only(user, admin):
    assert user.get(f"{BASE}/admin/api/overview", timeout=15).status_code == 403
    assert requests.get(f"{BASE}/admin/api/overview", timeout=15).status_code == 401
    ov = admin.get(f"{BASE}/admin/api/overview", timeout=15).json()
    assert ov["users"] >= 2 and ov["awaitingLicense"] >= 1


def test_license_key_flow(admin, user):
    r = admin.post(f"{BASE}/admin/api/licenses", json={"days": 30, "note": "pytest"}, timeout=15)
    assert r.status_code == 200
    key = r.json()["key"]
    assert key.startswith("WSX-") and len(key) == 23
    lst = admin.get(f"{BASE}/admin/api/licenses", timeout=15).json()
    mine = [l for l in lst if l["id"] == r.json()["view"]["id"]][0]
    assert key not in mine["mask"] and mine["mask"].endswith(key[-4:])

    bad = user.post(f"{BASE}/ai-api/auth/license", json={"key": "WSX-AAAA-BBBB-CCCC-DDDD"}, timeout=15)
    assert bad.status_code == 400 and bad.json()["code"] == "INVALID"
    ok = user.post(f"{BASE}/ai-api/auth/license", json={"key": key.lower()}, timeout=15)
    assert ok.status_code == 200
    again = user.post(f"{BASE}/ai-api/auth/license", json={"key": key}, timeout=15)
    assert again.status_code == 400 and again.json()["code"] == "USED"

    sess = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()
    assert sess["access"] == "ok" and sess["user"]["licenseUntil"] > 0
    assert user.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 200


def test_user_isolation(admin, user):
    """Диалоги пользователя не видны админу и наоборот."""
    r = user.post(f"{BASE}/ai-api/sessions", json={"title": "Приватный диалог"}, timeout=15)
    assert r.status_code == 200
    sid = r.json()["id"]
    assert sid in {s["id"] for s in user.get(f"{BASE}/ai-api/sessions", timeout=15).json()}
    assert sid not in {s["id"] for s in admin.get(f"{BASE}/ai-api/sessions", timeout=15).json()}
    assert admin.get(f"{BASE}/ai-api/sessions/{sid}", timeout=15).status_code == 404


def test_feature_toggle(admin, user):
    uid = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]["id"]
    feats = {"ai": False, "mcp": True, "sync": True, "secrets": True, "offline": True, "telemetry": True}
    r = admin.patch(f"{BASE}/admin/api/users/{uid}", json={"features": feats, "aiDailyLimit": 3}, timeout=15)
    assert r.status_code == 200 and r.json()["features"]["ai"] is False and r.json()["aiDailyLimit"] == 3
    d = user.get(f"{BASE}/ai-api/sessions", timeout=15)
    assert d.status_code == 403 and d.json()["code"] == "FEATURE_DISABLED"
    assert user.get(f"{BASE}/mcp/admin/tokens", timeout=15).status_code == 200
    feats["ai"] = True
    assert admin.patch(f"{BASE}/admin/api/users/{uid}", json={"features": feats}, timeout=15).status_code == 200
    assert user.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 200


def test_admin_cannot_demote_self(admin):
    me = admin.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]["id"]
    r = admin.patch(f"{BASE}/admin/api/users/{me}", json={"status": "blocked"}, timeout=15)
    assert r.status_code == 409
    assert admin.delete(f"{BASE}/admin/api/users/{me}", timeout=15).status_code == 409


def test_reset_password_and_sessions(admin, user):
    uid = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]["id"]
    r = admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "reset-password", "password": "temp-pass-99999"}, timeout=15)
    assert r.status_code == 200
    # старая сессия завершена
    assert user.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 401
    s2 = requests.Session()
    r = s2.post(f"{BASE}/ai-api/auth/login", json={"email": EMAIL, "password": "temp-pass-99999"}, timeout=15)
    assert r.status_code == 200 and r.json()["user"]["mustChangePassword"] is True
    assert s2.get(f"{BASE}/ai-api/sessions", timeout=15).json()["code"] == "PASSWORD_CHANGE_REQUIRED"
    r = s2.post(f"{BASE}/ai-api/auth/password", json={"next": USER_PASS}, timeout=15)
    assert r.status_code == 200
    assert s2.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 200
    # завершение сессий админом
    assert admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "terminate-sessions"}, timeout=15).json()["ended"] >= 1
    assert s2.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 401
    pytest.uid = uid


def test_block_and_delete(admin):
    uid = pytest.uid
    s3 = requests.Session()
    assert s3.post(f"{BASE}/ai-api/auth/login", json={"email": EMAIL, "password": USER_PASS}, timeout=15).status_code == 200
    r = admin.patch(f"{BASE}/admin/api/users/{uid}", json={"status": "blocked"}, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "blocked"
    assert s3.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 401
    bl = requests.post(f"{BASE}/ai-api/auth/login", json={"email": EMAIL, "password": USER_PASS}, timeout=15)
    assert bl.status_code == 403 and bl.json()["code"] == "BLOCKED"
    assert admin.delete(f"{BASE}/admin/api/users/{uid}", timeout=15).status_code == 200
    assert uid not in {u["id"] for u in admin.get(f"{BASE}/admin/api/users", timeout=15).json()}
    assert requests.post(f"{BASE}/ai-api/auth/login", json={"email": EMAIL, "password": USER_PASS}, timeout=15).status_code == 401
