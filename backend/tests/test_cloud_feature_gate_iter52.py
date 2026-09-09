"""Cloud feature-gate backend regression tests for /ai-api/cloud routes."""

import io
import os
import uuid
from pathlib import Path

import pytest
import requests


BASE_URL = os.environ.get("APP_URL")
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN", "admin")
ADMIN_PASSWORD = os.environ.get("APP_PASSWORD")
CREDS_FILE = Path("/app/memory/test_credentials.md")


def _must_env(name: str, value: str | None) -> str:
    if not value:
        pytest.skip(f"{name} is not set")
    return value.rstrip("/")


def _append_credential(login: str, password: str) -> None:
    with CREDS_FILE.open("a", encoding="utf-8") as out:
        out.write(f"\n- Iter52 cloud gate temp: `{login}` / `{password}` (удаляется в teardown).\n")


def _mark_deleted(login: str) -> None:
    if not CREDS_FILE.exists():
        return
    lines = CREDS_FILE.read_text(encoding="utf-8").splitlines()
    CREDS_FILE.write_text(
        "\n".join(
            f"- Iter52 cloud gate temp account `{login}` deleted."
            if f"`{login}` /" in line
            else line
            for line in lines
        )
        + "\n",
        encoding="utf-8",
    )


@pytest.fixture(scope="module")
def base_url() -> str:
    return _must_env("APP_URL", BASE_URL)


@pytest.fixture(scope="module")
def admin(base_url: str):
    _must_env("APP_PASSWORD", ADMIN_PASSWORD)
    session = requests.Session()
    response = session.post(
        f"{base_url}/ai-api/auth/login",
        json={"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert response.status_code == 200, response.text
    return session


def _make_user(admin: requests.Session, base_url: str, role_label: str, plan_name: str) -> tuple[str, str]:
    login = f"iter52-{role_label}-{uuid.uuid4().hex[:8]}"
    password = f"Iter52-{uuid.uuid4().hex[:10]}"

    plans = admin.get(f"{base_url}/admin/api/plans", timeout=20)
    assert plans.status_code == 200, plans.text
    plan = next((p for p in plans.json() if p.get("name") == plan_name), None)
    assert plan is not None, f"{plan_name} plan not found"

    key_resp = admin.post(
        f"{base_url}/admin/api/licenses",
        json={"planId": plan["id"], "days": 7, "count": 1, "note": f"iter52-{role_label}"},
        timeout=20,
    )
    assert key_resp.status_code == 200, key_resp.text
    key = key_resp.json()["keys"][0]

    register = requests.Session().post(
        f"{base_url}/ai-api/auth/register",
        json={
            "login": login,
            "password": password,
            "passwordConfirm": password,
            "key": key,
        },
        timeout=20,
    )
    assert register.status_code == 200, register.text
    _append_credential(login, password)
    return login, password


def _login(base_url: str, login: str, password: str) -> requests.Session:
    session = requests.Session()
    response = session.post(
        f"{base_url}/ai-api/auth/login",
        json={"login": login, "password": password},
        timeout=20,
    )
    assert response.status_code == 200, response.text
    return session


@pytest.fixture(scope="module")
def users(admin: requests.Session, base_url: str):
    # Pro user: cloud=true. Basic user: cloud=false.
    pro_login, pro_password = _make_user(admin, base_url, "pro", "Pro")
    basic_login, basic_password = _make_user(admin, base_url, "basic", "Basic")

    pro = _login(base_url, pro_login, pro_password)
    basic = _login(base_url, basic_login, basic_password)

    users_resp = admin.get(f"{base_url}/admin/api/users", timeout=20)
    assert users_resp.status_code == 200, users_resp.text
    admin_users = users_resp.json()
    pro_meta = next((u for u in admin_users if u.get("login") == pro_login), None)
    basic_meta = next((u for u in admin_users if u.get("login") == basic_login), None)
    assert pro_meta is not None and basic_meta is not None

    yield {
        "pro_login": pro_login,
        "basic_login": basic_login,
        "pro": pro,
        "basic": basic,
        "pro_meta": pro_meta,
        "basic_meta": basic_meta,
    }

    users_resp = admin.get(f"{base_url}/admin/api/users", timeout=20)
    if users_resp.status_code == 200:
        all_users = users_resp.json()
        for login in (pro_login, basic_login):
            uid = next((u["id"] for u in all_users if u.get("login") == login), None)
            if uid:
                admin.delete(f"{base_url}/admin/api/users/{uid}", timeout=20)
            _mark_deleted(login)


class TestCloudFeatureGateIter52:
    """Feature flag checks: cloud=false must receive FEATURE_DISABLED on all /ai-api/cloud paths."""

    def test_admin_bypass_kept_for_cloud_list(self, admin: requests.Session, base_url: str):
        response = admin.get(f"{base_url}/ai-api/cloud", timeout=20)
        assert response.status_code == 200, response.text
        body = response.json()
        assert "member" in body
        assert isinstance(body.get("files", []), list)

    def test_pro_user_is_not_feature_blocked(self, users: dict, base_url: str):
        assert users["pro_meta"].get("features", {}).get("cloud") is True
        response = users["pro"].get(f"{base_url}/ai-api/cloud", timeout=20)
        assert response.status_code == 200, response.text
        assert response.json().get("member") in [True, False]

    def test_basic_cloud_false_blocked_for_root_and_children(self, users: dict, base_url: str):
        basic = users["basic"]
        assert users["basic_meta"].get("features", {}).get("cloud") is False
        unique = uuid.uuid4().hex[:8]

        checks: list[tuple[str, requests.Response]] = [
            ("GET /ai-api/cloud", basic.get(f"{base_url}/ai-api/cloud", timeout=20)),
            (
                "POST /ai-api/cloud/upload",
                basic.post(
                    f"{base_url}/ai-api/cloud/upload",
                    data={"dir": ""},
                    files={"file": ("iter52.txt", io.BytesIO(b"iter52"), "text/plain")},
                    timeout=20,
                ),
            ),
            (
                "POST /ai-api/cloud/share",
                basic.post(
                    f"{base_url}/ai-api/cloud/share",
                    json={"kind": "note", "sourceId": f"iter52-note-{unique}", "title": "t", "body": "b", "tags": []},
                    timeout=20,
                ),
            ),
            (
                "GET /ai-api/cloud/file/{id}",
                basic.get(f"{base_url}/ai-api/cloud/file/iter52-missing", timeout=20),
            ),
            (
                "DELETE /ai-api/cloud/file/{id}",
                basic.delete(f"{base_url}/ai-api/cloud/file/iter52-missing", timeout=20),
            ),
            (
                "POST /ai-api/cloud/join",
                basic.post(f"{base_url}/ai-api/cloud/join", json={"code": "deadbeef"}, timeout=20),
            ),
        ]

        failures = []
        for label, response in checks:
            try:
                body = response.json()
            except Exception:
                body = {"raw": response.text}
            if response.status_code != 403 or body.get("code") != "FEATURE_DISABLED":
                failures.append(f"{label}: status={response.status_code} body={body}")

        assert not failures, " | ".join(failures)
