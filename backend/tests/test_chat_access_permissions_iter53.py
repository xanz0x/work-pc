"""Chat access + temp mail guard regression (targeted iteration 53)."""

import os
import time
import requests
import pytest


BASE_URL = os.environ.get("APP_URL")
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN")
ADMIN_PASSWORD = os.environ.get("APP_PASSWORD")


def _must_env(name: str, value: str | None) -> str:
    if not value:
        pytest.skip(f"{name} is not configured")
    return value


@pytest.fixture(scope="session")
def app_url() -> str:
    return _must_env("APP_URL", BASE_URL).rstrip("/")


@pytest.fixture(scope="session")
def admin_session(app_url: str) -> requests.Session:
    """Auth module: login as admin and keep cookie session."""
    _must_env("ADMIN_LOGIN", ADMIN_LOGIN)
    _must_env("APP_PASSWORD", ADMIN_PASSWORD)
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(
        f"{app_url}/ai-api/auth/login",
        json={"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert isinstance(data.get("user"), dict)
    return s


@pytest.fixture
def restricted_user(admin_session: requests.Session, app_url: str):
    """Permissions module: create restricted user and cleanup after checks."""
    stamp = int(time.time())
    login = f"test_restrict_{stamp}"
    password = "TEST-pass-1234"
    final_password = "TEST-pass-1234-upd"

    plans_r = admin_session.get(f"{app_url}/admin/api/plans", timeout=30)
    assert plans_r.status_code == 200
    plans = plans_r.json()
    assert isinstance(plans, list) and len(plans) > 0
    plan_id = plans[0]["id"]

    create = admin_session.post(
        f"{app_url}/admin/api/users",
        json={
            "login": login,
            "name": "TEST restricted",
            "password": password,
            "role": "user",
            "planId": plan_id,
            "licenseDays": 30,
        },
        timeout=30,
    )
    assert create.status_code == 200
    created = create.json()
    assert isinstance(created.get("id"), str)
    uid = created["id"]

    patch = admin_session.patch(
        f"{app_url}/admin/api/users/{uid}",
        json={
            "features": {
                "ai": True,
                "mcp": False,
                "sync": False,
                "secrets": False,
                "offline": True,
                "telemetry": True,
                "mail": False,
                "cloud": False,
            }
        },
        timeout=30,
    )
    assert patch.status_code == 200
    patched = patch.json()
    assert patched["features"]["ai"] is True
    assert patched["features"]["secrets"] is False
    assert patched["features"]["mail"] is False
    assert patched["features"]["cloud"] is False

    user_s = requests.Session()
    user_s.headers.update({"Content-Type": "application/json"})
    login_r = user_s.post(
        f"{app_url}/ai-api/auth/login",
        json={"login": login, "password": password},
        timeout=30,
    )
    assert login_r.status_code == 200
    assert login_r.json().get("ok") is True

    change = user_s.post(
        f"{app_url}/ai-api/auth/password",
        json={"next": final_password},
        timeout=30,
    )
    assert change.status_code == 200
    assert change.json().get("ok") is True

    user_s = requests.Session()
    user_s.headers.update({"Content-Type": "application/json"})
    relogin = user_s.post(
        f"{app_url}/ai-api/auth/login",
        json={"login": login, "password": final_password},
        timeout=30,
    )
    assert relogin.status_code == 200
    assert relogin.json().get("ok") is True

    try:
        yield {"uid": uid, "login": login, "password": final_password, "session": user_s}
    finally:
        admin_session.delete(f"{app_url}/admin/api/users/{uid}", timeout=30)


def test_chat_access_get_returns_tools(admin_session: requests.Session, app_url: str):
    r = admin_session.get(f"{app_url}/ai-api/chat/access", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data.get("tools"), list)
    assert any(t.get("name") == "generate_password" for t in data["tools"])


def test_chat_access_unknown_tool_is_forbidden(admin_session: requests.Session, app_url: str):
    r = admin_session.post(
        f"{app_url}/ai-api/chat/access",
        json={"name": "fake_disabled_skill", "args": {}},
        timeout=30,
    )
    assert r.status_code == 403
    data = r.json()
    assert data.get("ok") is False
    assert isinstance(data.get("error"), str)


@pytest.mark.parametrize(
    "tool_name,args",
    [
        ("save_password", {"title": "X", "url": "https://example.com"}),
        ("generate_password", {"length": 20}),
        ("create_mailbox", {"kind": "gmail"}),
        ("open_app", {"section": "admin"}),
        ("open_app", {"section": "settings", "setting": "cloud"}),
    ],
)
def test_restricted_user_gets_403_for_blocked_chat_actions(
    restricted_user: dict,
    app_url: str,
    tool_name: str,
    args: dict,
):
    r = restricted_user["session"].post(
        f"{app_url}/ai-api/chat/access",
        json={"name": tool_name, "args": args},
        timeout=30,
    )
    assert r.status_code == 403
    data = r.json()
    assert data.get("ok") is False
    assert "Недостаточно прав" in str(data.get("error"))


def test_gmail_create_mailbox_honest_refusal_when_not_configured(admin_session: requests.Session, app_url: str):
    """Temp mail module: missing MAIL_SECRET/SONJJ_API_KEY must not return mailbox success payload."""
    r = admin_session.post(
        f"{app_url}/ai-api/mail/temp",
        json={"kind": "gmail"},
        timeout=30,
    )
    assert r.status_code in (503, 429)
    data = r.json()
    assert data.get("box") is None
    assert isinstance(data.get("error"), str)
