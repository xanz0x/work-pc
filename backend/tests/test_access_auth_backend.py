"""Auth/API regression for access flows (login/register/key/session)."""

import os
import time
import uuid

import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("APP_URL")
if not BASE_URL:
    raise RuntimeError("Set REACT_APP_BACKEND_URL or APP_URL before running tests")
BASE_URL = BASE_URL.rstrip("/")

ADMIN_PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN", "admin")


@pytest.fixture(scope="module")
def admin_session():
    """Admin-authenticated HTTP session."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(
        f"{BASE_URL}/ai-api/auth/login",
        json={"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert body.get("ok") is True
    assert body.get("user", {}).get("role") == "admin"
    return s


@pytest.fixture(scope="module")
def disposable_registration_data(admin_session):
    """Create disposable license key and cleanup created user after tests."""
    plans_resp = admin_session.get(f"{BASE_URL}/admin/api/plans", timeout=20)
    assert plans_resp.status_code == 200
    plans = plans_resp.json()
    basic = next((p for p in plans if p.get("name") == "Basic"), None)
    assert basic is not None

    issue_resp = admin_session.post(
        f"{BASE_URL}/admin/api/licenses",
        json={"planId": basic["id"], "days": 7, "note": "visual_access_test", "count": 1},
        timeout=20,
    )
    assert issue_resp.status_code == 200, issue_resp.text
    issued = issue_resp.json()
    key = issued["keys"][0]
    key_view = issued["views"][0]
    assert key.startswith("WSX-")
    assert key_view.get("id")

    login = f"visual_access_test_{uuid.uuid4().hex[:8]}"
    password = "VisualAccessTest2026!"
    created_user_id = None

    def _set_created_user_id(uid):
        nonlocal created_user_id
        created_user_id = uid

    yield {
        "key": key,
        "key_id": key_view["id"],
        "login": login,
        "password": password,
        "created_user_id_ref": lambda: created_user_id,
        "set_created_user_id": lambda uid: _set_created_user_id(uid),
    }

    # cleanup user if created
    if created_user_id:
        admin_session.delete(f"{BASE_URL}/admin/api/users/{created_user_id}", timeout=20)
    # cleanup key if still revokable
    admin_session.delete(f"{BASE_URL}/admin/api/licenses?id={key_view['id']}", timeout=20)


# auth + validation checks for the login/register/key/session endpoints
def test_login_rejects_invalid_password():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/ai-api/auth/login",
        json={"login": ADMIN_LOGIN, "password": "wrong-password-123"},
        timeout=20,
    )
    assert r.status_code == 401
    body = r.json()
    assert body.get("code") == "AUTH_REQUIRED"
    assert isinstance(body.get("error"), str) and body["error"]


def test_login_allows_empty_login_for_admin():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/ai-api/auth/login",
        json={"password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("user", {}).get("role") == "admin"
    assert isinstance(body.get("expires"), int)


def test_login_allows_explicit_admin_login():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/ai-api/auth/login",
        json={"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("user", {}).get("login") == ADMIN_LOGIN


def test_register_validation_short_password_and_mismatch():
    bad_short = requests.post(
        f"{BASE_URL}/ai-api/auth/register",
        json={
            "login": f"visual_access_test_{int(time.time())}",
            "password": "short",
            "passwordConfirm": "short",
            "key": "WSX-AAAA-BBBB-CCCC-DDDD",
        },
        timeout=20,
    )
    assert bad_short.status_code == 400
    short_data = bad_short.json()
    assert short_data.get("code") == "INVALID_ARGS"

    bad_mismatch = requests.post(
        f"{BASE_URL}/ai-api/auth/register",
        json={
            "login": f"visual_access_test_{int(time.time())}_m",
            "password": "VisualMismatch2026!",
            "passwordConfirm": "VisualMismatchDIFF2026!",
            "key": "WSX-AAAA-BBBB-CCCC-DDDD",
        },
        timeout=20,
    )
    assert bad_mismatch.status_code == 400
    mismatch_data = bad_mismatch.json()
    assert mismatch_data.get("code") == "INVALID_ARGS"
    assert "совп" in mismatch_data.get("error", "").lower()


def test_key_preview_validation_invalid_key_shape():
    r = requests.post(
        f"{BASE_URL}/ai-api/auth/key",
        json={"key": "BAD-KEY"},
        timeout=20,
    )
    assert r.status_code == 400
    body = r.json()
    assert body.get("code") == "INVALID"
    assert "WSX-" in body.get("error", "")


def test_register_real_disposable_account_and_session(
    admin_session, disposable_registration_data
):
    key = disposable_registration_data["key"]
    login = disposable_registration_data["login"]
    password = disposable_registration_data["password"]

    # key preview before registration
    key_preview = requests.post(
        f"{BASE_URL}/ai-api/auth/key", json={"key": key}, timeout=20
    )
    assert key_preview.status_code == 200
    kp_data = key_preview.json()
    assert kp_data.get("plan", {}).get("name") == "Basic"
    assert isinstance(kp_data.get("days"), int)

    user_sess = requests.Session()
    reg = user_sess.post(
        f"{BASE_URL}/ai-api/auth/register",
        json={
            "login": login,
            "password": password,
            "passwordConfirm": password,
            "key": key,
        },
        timeout=20,
    )
    assert reg.status_code == 200, reg.text
    reg_data = reg.json()
    user = reg_data.get("user", {})
    assert user.get("login") == login
    assert user.get("role") == "user"
    assert user.get("plan", {}).get("name") == "Basic"
    disposable_registration_data["set_created_user_id"](user.get("id"))

    # Create -> GET verification: confirm session persisted for created user
    sess = user_sess.get(f"{BASE_URL}/ai-api/auth/session", timeout=20)
    assert sess.status_code == 200
    sess_data = sess.json()
    assert sess_data.get("authed") is True
    assert sess_data.get("access") == "ok"
    assert sess_data.get("user", {}).get("login") == login


def test_redeem_license_requires_auth():
    r = requests.post(
        f"{BASE_URL}/ai-api/auth/license",
        json={"key": "WSX-AAAA-BBBB-CCCC-DDDD"},
        timeout=20,
    )
    assert r.status_code == 401
    body = r.json()
    assert body.get("code") == "AUTH_REQUIRED"
