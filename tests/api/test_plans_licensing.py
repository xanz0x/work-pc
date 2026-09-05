"""Итерация 28 · Тарифы, ключи лицензий, регистрация по ключу, админ-действия.

Прогон: APP_URL=https://layout-perfect-4.preview.emergentagent.com \
        python3 -m pytest tests/api/test_plans_licensing.py -q
"""
import os
import time
import uuid

import pytest
import requests

BASE = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")
USER_PASS = "qa-pass-12345"
KEY_RE = r"^WSX(-[A-Z2-9]{4}){4}$"
STAMP = uuid.uuid4().hex[:6]
# уникальный «IP» на прогон, чтобы не выедать общий rate-limit
XFF = {"X-Forwarded-For": f"10.28.{int(time.time()) % 250}.{os.getpid() % 250}"}

_created_plans: list[str] = []
_created_users: list[str] = []


# ---------------------------------------------------------------- фикстуры
@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update(XFF)
    r = s.post(f"{BASE}/ai-api/auth/login", json={"login": "admin", "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["role"] == "admin"
    assert body["user"]["login"] == "admin"
    return s


@pytest.fixture(scope="module")
def plans(admin):
    r = admin.get(f"{BASE}/admin/api/plans", timeout=20)
    assert r.status_code == 200, r.text
    lst = r.json()
    assert {p["name"] for p in lst} >= {"Basic", "Pro", "Enterprise"}
    return {p["name"]: p for p in lst}


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin):
    yield
    for uid in _created_users:
        admin.delete(f"{BASE}/admin/api/users/{uid}", timeout=20)
    for pid in _created_plans:
        admin.delete(f"{BASE}/admin/api/plans/{pid}", timeout=20)


def issue(admin, plan_id, days=30, count=1, note="qa-28"):
    r = admin.post(f"{BASE}/admin/api/licenses",
                   json={"planId": plan_id, "days": days, "note": note, "count": count}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def register(login, key):
    s = requests.Session()
    s.headers.update(XFF)
    r = s.post(f"{BASE}/ai-api/auth/register",
               json={"login": login, "password": USER_PASS, "passwordConfirm": USER_PASS, "key": key}, timeout=20)
    return s, r


# ---------------------------------------------------------------- auth/login
class TestLogin:
    def test_password_only_login_is_admin(self):
        r = requests.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD}, headers=XFF, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "admin"

    def test_wrong_password_401(self):
        r = requests.post(f"{BASE}/ai-api/auth/login",
                          json={"login": "admin", "password": "definitely-wrong-1"}, headers=XFF, timeout=20)
        assert r.status_code in (401, 429), r.text


# ---------------------------------------------------------------- plans
class TestPlans:
    def test_plans_require_admin(self, plans, admin):
        anon = requests.get(f"{BASE}/admin/api/plans", headers=XFF, timeout=20)
        assert anon.status_code == 401
        for p in plans.values():
            for field in ("id", "name", "days", "aiDailyLimit", "features", "users", "freeKeys", "color"):
                assert field in p, f"{p['name']} missing {field}"
            assert isinstance(p["users"], int) and isinstance(p["freeKeys"], int)

    def test_plans_forbidden_for_regular_user(self, admin, plans):
        key = issue(admin, plans["Basic"]["id"])["keys"][0]
        sess, r = register(f"qa-{STAMP}-plans", key)
        assert r.status_code == 200, r.text
        _created_users.append(r.json()["user"]["id"])
        assert sess.get(f"{BASE}/admin/api/plans", timeout=20).status_code == 403

    def test_create_validation(self, admin):
        bad_name = admin.post(f"{BASE}/admin/api/plans", json={"name": "a", "days": 30, "aiDailyLimit": 10}, timeout=20)
        assert bad_name.status_code == 400, bad_name.text
        bad_color = admin.post(f"{BASE}/admin/api/plans",
                               json={"name": f"QA {STAMP}", "color": "chartreuse", "days": 30, "aiDailyLimit": 10},
                               timeout=20)
        assert bad_color.status_code == 400, bad_color.text

    def test_create_patch_delete(self, admin):
        payload = {
            "name": f"QA-{STAMP}", "tagline": "тариф для теста", "color": "blue",
            "days": 60, "aiDailyLimit": 20,
            "features": {"ai": True, "mcp": True, "sync": True, "secrets": True, "offline": True, "telemetry": True},
        }
        r = admin.post(f"{BASE}/admin/api/plans", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        plan = r.json()
        pid = plan.get("id") or plan.get("plan", {}).get("id")
        assert pid
        _created_plans.append(pid)

        lst = admin.get(f"{BASE}/admin/api/plans", timeout=20).json()
        stored = next(p for p in lst if p["id"] == pid)
        assert stored["name"] == payload["name"] and stored["days"] == 60
        assert stored["aiDailyLimit"] == 20 and stored["color"] == "blue"
        assert stored["features"]["mcp"] is True

        upd = admin.patch(f"{BASE}/admin/api/plans/{pid}", json={"days": 90}, timeout=20)
        assert upd.status_code == 200, upd.text
        after = next(p for p in admin.get(f"{BASE}/admin/api/plans", timeout=20).json() if p["id"] == pid)
        assert after["days"] == 90

        arch = admin.patch(f"{BASE}/admin/api/plans/{pid}", json={"archived": True}, timeout=20)
        assert arch.status_code == 200, arch.text
        after = next(p for p in admin.get(f"{BASE}/admin/api/plans", timeout=20).json() if p["id"] == pid)
        assert after["archived"] is True

        dele = admin.delete(f"{BASE}/admin/api/plans/{pid}", timeout=20)
        assert dele.status_code == 200, dele.text
        _created_plans.remove(pid)
        assert all(p["id"] != pid for p in admin.get(f"{BASE}/admin/api/plans", timeout=20).json())

    def test_delete_in_use_plan_409(self, admin, plans):
        used = next((p for p in plans.values() if p["users"] > 0), None)
        if used is None:
            key = issue(admin, plans["Basic"]["id"])["keys"][0]
            _, r = register(f"qa-{STAMP}-inuse", key)
            assert r.status_code == 200, r.text
            _created_users.append(r.json()["user"]["id"])
            used = plans["Basic"]
        r = admin.delete(f"{BASE}/admin/api/plans/{used['id']}", timeout=20)
        assert r.status_code == 409, r.text
        assert r.json().get("code") == "IN_USE"


# ---------------------------------------------------------------- licenses
class TestLicenses:
    def test_issue_multiple(self, admin, plans):
        body = issue(admin, plans["Pro"]["id"], days=15, count=2, note="qa-batch")
        assert len(body["keys"]) == 2 and len(body["views"]) == 2
        import re
        for k in body["keys"]:
            assert re.match(KEY_RE, k), k
        for v in body["views"]:
            assert v["planName"] == "Pro" and v["days"] == 15
            assert v["mask"].endswith(v["mask"][-4:])

    def test_count_limit_and_bad_plan(self, admin, plans):
        over = admin.post(f"{BASE}/admin/api/licenses",
                          json={"planId": plans["Pro"]["id"], "days": 30, "count": 26}, timeout=20)
        assert over.status_code == 400, over.text
        nope = admin.post(f"{BASE}/admin/api/licenses",
                          json={"planId": "no-such-plan", "days": 30, "count": 1}, timeout=20)
        assert nope.status_code == 400 and nope.json().get("code") == "NO_PLAN", nope.text

    def test_key_preview(self, admin, plans):
        key = issue(admin, plans["Enterprise"]["id"], days=45)["keys"][0]
        r = requests.post(f"{BASE}/ai-api/auth/key", json={"key": key}, headers=XFF, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True and body["plan"]["name"] == "Enterprise" and body["days"] == 45
        assert body["plan"].get("color")
        bad = requests.post(f"{BASE}/ai-api/auth/key", json={"key": "WSX-AAAA-BBBB-CCCC-DDDD"}, headers=XFF, timeout=20)
        assert bad.status_code == 400 and bad.json()["code"] == "INVALID"

    def test_revoke_key_blocks_registration(self, admin, plans):
        body = issue(admin, plans["Basic"]["id"])
        key = body["keys"][0]
        kid = body["views"][0]["id"]
        r = admin.post(f"{BASE}/admin/api/licenses", json={"action": "revoke", "id": kid}, timeout=20)
        if r.status_code != 200:
            r = admin.delete(f"{BASE}/admin/api/licenses?id={kid}", timeout=20)
        assert r.status_code == 200, r.text
        prev = requests.post(f"{BASE}/ai-api/auth/key", json={"key": key}, headers=XFF, timeout=20)
        assert prev.status_code == 400 and prev.json()["code"] == "REVOKED", prev.text


# ---------------------------------------------------------------- register
class TestRegister:
    def test_register_sets_plan_and_license(self, admin, plans):
        key = issue(admin, plans["Pro"]["id"], days=30)["keys"][0]
        login = f"QA-{STAMP}-Pro"
        sess, r = register(login, key)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        _created_users.append(u["id"])
        assert u["login"] == login.lower()
        assert u["plan"]["name"] == "Pro"
        assert u["features"]["mcp"] is True
        assert u["aiDailyLimit"] == plans["Pro"]["aiDailyLimit"]
        assert u["licenseUntil"] > int(time.time() * 1000)
        s = sess.get(f"{BASE}/ai-api/auth/session", timeout=20).json()
        assert s["authed"] and s["access"] == "ok"

    def test_key_reuse_and_login_taken(self, admin, plans):
        key = issue(admin, plans["Basic"]["id"])["keys"][0]
        login = f"qa-{STAMP}-reuse"
        _, r = register(login, key)
        assert r.status_code == 200, r.text
        _created_users.append(r.json()["user"]["id"])
        again = register(f"qa-{STAMP}-reuse2", key)[1]
        assert again.status_code == 400 and again.json()["code"] == "USED", again.text
        fresh = issue(admin, plans["Basic"]["id"])["keys"][0]
        taken = register(login, fresh)[1]
        assert taken.status_code == 409 and taken.json()["code"] == "LOGIN_TAKEN", taken.text

    def test_no_key_rejected(self):
        r = requests.post(f"{BASE}/ai-api/auth/register",
                          json={"login": f"qa-{STAMP}-nokey", "password": USER_PASS, "passwordConfirm": USER_PASS},
                          headers=XFF, timeout=20)
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------- upgrade / admin actions
class TestPlanSwitchAndAdminActions:
    @pytest.fixture(scope="class")
    def basic_user(self, admin, plans):
        key = issue(admin, plans["Basic"]["id"])["keys"][0]
        sess, r = register(f"qa-{STAMP}-flow", key)
        assert r.status_code == 200, r.text
        uid = r.json()["user"]["id"]
        _created_users.append(uid)
        return sess, uid

    def test_basic_feature_disabled_then_pro_key_unlocks(self, admin, plans, basic_user):
        sess, _uid = basic_user
        blocked = sess.get(f"{BASE}/mcp/admin/tokens", timeout=20)
        assert blocked.status_code == 403 and blocked.json()["code"] == "FEATURE_DISABLED", blocked.text
        pro_key = issue(admin, plans["Pro"]["id"], days=30)["keys"][0]
        up = sess.post(f"{BASE}/ai-api/auth/license", json={"key": pro_key}, timeout=20)
        assert up.status_code == 200, up.text
        s = sess.get(f"{BASE}/ai-api/auth/session", timeout=20).json()
        assert s["user"]["plan"]["name"] == "Pro"
        assert sess.get(f"{BASE}/mcp/admin/tokens", timeout=20).status_code == 200

    def test_admin_set_plan(self, admin, plans, basic_user):
        sess, uid = basic_user
        r = admin.post(f"{BASE}/admin/api/users/{uid}",
                       json={"action": "set-plan", "planId": plans["Enterprise"]["id"]}, timeout=20)
        assert r.status_code == 200, r.text
        s = sess.get(f"{BASE}/ai-api/auth/session", timeout=20).json()
        assert s["user"]["plan"]["name"] == "Enterprise"
        assert s["user"]["aiDailyLimit"] == plans["Enterprise"]["aiDailyLimit"]

    def test_grant_then_revoke_license(self, admin, basic_user):
        sess, uid = basic_user
        before = sess.get(f"{BASE}/ai-api/auth/session", timeout=20).json()["user"]["licenseUntil"]
        g = admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "grant-license", "days": 30}, timeout=20)
        assert g.status_code == 200, g.text
        after = sess.get(f"{BASE}/ai-api/auth/session", timeout=20).json()["user"]["licenseUntil"]
        assert after >= before

        rv = admin.post(f"{BASE}/admin/api/users/{uid}", json={"action": "revoke-license"}, timeout=20)
        assert rv.status_code == 200, rv.text
        blocked = sess.get(f"{BASE}/ai-api/sessions", timeout=20)
        assert blocked.status_code == 403 and blocked.json()["code"] == "LICENSE_REQUIRED", blocked.text
        s = sess.get(f"{BASE}/ai-api/auth/session", timeout=20).json()
        assert s["access"] == "license"


# ---------------------------------------------------------------- manual create
class TestManualCreate:
    def test_create_user_with_plan(self, admin, plans):
        login = f"qa-{STAMP}-manual"
        r = admin.post(f"{BASE}/admin/api/users",
                       json={"login": login, "name": "QA Manual", "password": "temp-pass-12345",
                             "role": "user", "planId": plans["Pro"]["id"], "licenseDays": 30}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        u = body.get("user", body)
        _created_users.append(u["id"])
        assert u["login"] == login
        assert u["mustChangePassword"] is True
        assert u["plan"]["name"] == "Pro"
        assert u["licenseUntil"] > int(time.time() * 1000)
        lst = admin.get(f"{BASE}/admin/api/users", timeout=20).json()
        rows = lst if isinstance(lst, list) else lst.get("users", [])
        assert any(x["login"] == login for x in rows)
