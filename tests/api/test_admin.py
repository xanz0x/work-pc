"""Аккаунты и админ-панель: тарифы → ключ → регистрация по ключу → функции → блокировка → удаление.

Прогон: APP_URL=https://<preview> python3 -m pytest tests/api/test_admin.py -q
"""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")
LOGIN = f"user-{uuid.uuid4().hex[:6]}"
USER_PASS = "user-pass-12345"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"login": "admin", "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "admin"
    return s


@pytest.fixture(scope="module")
def plans(admin):
    lst = admin.get(f"{BASE}/admin/api/plans", timeout=15).json()
    assert {p["name"] for p in lst} >= {"Basic", "Pro", "Enterprise"}
    return {p["name"]: p for p in lst}


@pytest.fixture(scope="module")
def key(admin, plans):
    r = admin.post(f"{BASE}/admin/api/licenses", json={"planId": plans["Basic"]["id"], "days": 30, "note": "pytest", "count": 1}, timeout=15)
    assert r.status_code == 200, r.text
    k = r.json()["keys"][0]
    assert k.startswith("WSX-") and len(k) == 23
    view = r.json()["views"][0]
    assert k not in view["mask"] and view["mask"].endswith(k[-4:]) and view["planName"] == "Basic"
    return k


@pytest.fixture(scope="module")
def user(key):
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/register", json={"login": LOGIN.upper(), "password": USER_PASS, "passwordConfirm": USER_PASS, "key": key.lower()}, timeout=15)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["role"] == "user" and u["login"] == LOGIN and u["plan"]["name"] == "Basic"
    assert u["features"]["mcp"] is False and u["aiDailyLimit"] == 50
    return s


def test_key_preview(key):
    r = requests.post(f"{BASE}/ai-api/auth/key", json={"key": key}, timeout=15)
    assert r.status_code == 200 and r.json()["plan"]["name"] == "Basic" and r.json()["days"] == 30
    bad = requests.post(f"{BASE}/ai-api/auth/key", json={"key": "WSX-AAAA-BBBB-CCCC-DDDD"}, timeout=15)
    assert bad.status_code == 400 and bad.json()["code"] == "INVALID"


def test_register_validation(key):
    post = lambda body: requests.post(f"{BASE}/ai-api/auth/register", json=body, timeout=15)
    assert post({"login": "ab", "password": USER_PASS, "passwordConfirm": USER_PASS, "key": key}).status_code == 400
    assert post({"login": "bad name", "password": USER_PASS, "passwordConfirm": USER_PASS, "key": key}).status_code == 400
    assert post({"login": "okname", "password": "short", "passwordConfirm": "short", "key": key}).status_code == 400
    assert post({"login": "okname", "password": USER_PASS, "passwordConfirm": "other-pass-1", "key": key}).status_code == 400
    r = post({"login": "okname", "password": USER_PASS, "passwordConfirm": USER_PASS, "key": "WSX-AAAA-BBBB-CCCC-DDDD"})
    assert r.status_code == 400 and r.json()["code"] == "INVALID"
    assert post({"login": "okname", "password": USER_PASS, "passwordConfirm": USER_PASS}).status_code == 400


def test_registered_user_has_access(user):
    sess = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()
    assert sess["authed"] and sess["access"] == "ok" and sess["user"]["licenseUntil"] > 0
    assert user.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 200
    # Basic: MCP выключен тарифом
    assert user.get(f"{BASE}/mcp/admin/tokens", timeout=15).json()["code"] == "FEATURE_DISABLED"
    assert user.get(f"{BASE}/admin/api/users", timeout=15).status_code == 403


def test_key_is_single_use(user, key):
    r = requests.post(f"{BASE}/ai-api/auth/register", json={"login": "another1", "password": USER_PASS, "passwordConfirm": USER_PASS, "key": key}, timeout=15)
    assert r.status_code == 400 and r.json()["code"] == "USED"
    again = user.post(f"{BASE}/ai-api/auth/license", json={"key": key}, timeout=15)
    assert again.status_code == 400 and again.json()["code"] == "USED"


def test_duplicate_login(user, admin, plans):
    k = admin.post(f"{BASE}/admin/api/licenses", json={"planId": plans["Basic"]["id"], "days": 7}, timeout=15).json()["keys"][0]
    r = requests.post(f"{BASE}/ai-api/auth/register", json={"login": LOGIN, "password": USER_PASS, "passwordConfirm": USER_PASS, "key": k}, timeout=15)
    assert r.status_code == 409 and r.json()["code"] == "LOGIN_TAKEN"


def test_upgrade_by_pro_key(admin, user, plans):
    k = admin.post(f"{BASE}/admin/api/licenses", json={"planId": plans["Pro"]["id"], "days": 10}, timeout=15).json()["keys"][0]
    assert user.post(f"{BASE}/ai-api/auth/license", json={"key": k}, timeout=15).status_code == 200
    u = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]
    assert u["plan"]["name"] == "Pro" and u["features"]["mcp"] is True and u["aiDailyLimit"] == 300
    assert user.get(f"{BASE}/mcp/admin/tokens", timeout=15).status_code == 200


def test_admin_only(user, admin):
    assert user.get(f"{BASE}/admin/api/overview", timeout=15).status_code == 403
    assert requests.get(f"{BASE}/admin/api/overview", timeout=15).status_code == 401
    ov = admin.get(f"{BASE}/admin/api/overview", timeout=15).json()
    assert ov["users"] >= 2 and ov["licensed"] >= 1 and ov["plans"] >= 3


def test_plan_crud(admin):
    body = {"name": "Team", "tagline": "pytest", "color": "blue", "days": 60, "aiDailyLimit": 20,
            "features": {"ai": True, "mcp": False, "sync": True, "secrets": True, "offline": False, "telemetry": True}}
    r = admin.post(f"{BASE}/admin/api/plans", json=body, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    assert admin.post(f"{BASE}/admin/api/plans", json={**body, "name": "x"}, timeout=15).status_code == 400
    r = admin.patch(f"{BASE}/admin/api/plans/{pid}", json={"days": 90, "archived": True}, timeout=15)
    assert r.status_code == 200 and r.json()["days"] == 90 and r.json()["archived"] is True
    assert admin.delete(f"{BASE}/admin/api/plans/{pid}", timeout=15).status_code == 200
    assert pid not in {p["id"] for p in admin.get(f"{BASE}/admin/api/plans", timeout=15).json()}


def test_set_plan_and_license_by_admin(admin, user, plans):
    uid = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]["id"]
    r = admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "set-plan", "planId": plans["Enterprise"]["id"]}, timeout=15)
    assert r.status_code == 200 and r.json()["plan"]["name"] == "Enterprise" and r.json()["aiDailyLimit"] == 0
    before = r.json()["licenseUntil"]
    r = admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "grant-license", "days": 30}, timeout=15)
    assert r.status_code == 200 and r.json()["licenseUntil"] > before
    r = admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "revoke-license"}, timeout=15)
    assert r.status_code == 200 and r.json()["licenseUntil"] is None
    d = user.get(f"{BASE}/ai-api/sessions", timeout=15)
    assert d.status_code == 403 and d.json()["code"] == "LICENSE_REQUIRED"
    assert admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "grant-license", "days": 30}, timeout=15).status_code == 200
    assert user.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 200


def test_user_isolation(admin, user):
    r = user.post(f"{BASE}/ai-api/sessions", json={"title": "Приватный диалог"}, timeout=15)
    assert r.status_code == 200
    sid = r.json()["id"]
    assert sid in {s["id"] for s in user.get(f"{BASE}/ai-api/sessions", timeout=15).json()}
    assert sid not in {s["id"] for s in admin.get(f"{BASE}/ai-api/sessions", timeout=15).json()}


def test_feature_toggle(admin, user):
    uid = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]["id"]
    feats = {"ai": False, "mcp": True, "sync": True, "secrets": True, "offline": True, "telemetry": True}
    r = admin.patch(f"{BASE}/admin/api/users/{uid}", json={"features": feats, "aiDailyLimit": 3}, timeout=15)
    assert r.status_code == 200 and r.json()["features"]["ai"] is False and r.json()["aiDailyLimit"] == 3
    d = user.get(f"{BASE}/ai-api/sessions", timeout=15)
    assert d.status_code == 403 and d.json()["code"] == "FEATURE_DISABLED"
    feats["ai"] = True
    assert admin.patch(f"{BASE}/admin/api/users/{uid}", json={"features": feats}, timeout=15).status_code == 200
    assert user.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 200


def test_admin_cannot_demote_self(admin):
    me = admin.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]["id"]
    assert admin.patch(f"{BASE}/admin/api/users/{me}", json={"status": "blocked"}, timeout=15).status_code == 409
    assert admin.delete(f"{BASE}/admin/api/users/{me}", timeout=15).status_code == 409


def test_reset_password_and_sessions(admin, user):
    uid = user.get(f"{BASE}/ai-api/auth/session", timeout=15).json()["user"]["id"]
    r = admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "reset-password", "password": "temp-pass-99999"}, timeout=15)
    assert r.status_code == 200
    assert user.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 401
    s2 = requests.Session()
    r = s2.post(f"{BASE}/ai-api/auth/login", json={"login": LOGIN, "password": "temp-pass-99999"}, timeout=15)
    assert r.status_code == 200 and r.json()["user"]["mustChangePassword"] is True
    assert s2.get(f"{BASE}/ai-api/sessions", timeout=15).json()["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert s2.post(f"{BASE}/ai-api/auth/password", json={"next": USER_PASS}, timeout=15).status_code == 200
    assert s2.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 200
    assert admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "terminate-sessions"}, timeout=15).json()["ended"] >= 1
    assert s2.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 401
    pytest.uid = uid


def test_block_and_delete(admin):
    uid = pytest.uid
    s3 = requests.Session()
    assert s3.post(f"{BASE}/ai-api/auth/login", json={"login": LOGIN, "password": USER_PASS}, timeout=15).status_code == 200
    r = admin.patch(f"{BASE}/admin/api/users/{uid}", json={"status": "blocked"}, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "blocked"
    assert s3.get(f"{BASE}/ai-api/sessions", timeout=15).status_code == 401
    bl = requests.post(f"{BASE}/ai-api/auth/login", json={"login": LOGIN, "password": USER_PASS}, timeout=15)
    assert bl.status_code == 403 and bl.json()["code"] == "BLOCKED"
    assert admin.delete(f"{BASE}/admin/api/users/{uid}", timeout=15).status_code == 200
    assert uid not in {u["id"] for u in admin.get(f"{BASE}/admin/api/users", timeout=15).json()}
    assert requests.post(f"{BASE}/ai-api/auth/login", json={"login": LOGIN, "password": USER_PASS}, timeout=15).status_code == 401
