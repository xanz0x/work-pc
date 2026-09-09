"""Admin + cloud two-session regression (second admin, password rotation, shared file access)."""

import io
import os
import time
import uuid

import pytest
import requests


BASE_URL = os.environ.get("APP_URL")
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN")
APP_PASSWORD = os.environ.get("APP_PASSWORD")


def _must_env(name: str, value: str | None) -> str:
    if not value:
        pytest.skip(f"{name} is not configured")
    return value.rstrip("/")


@pytest.fixture(scope="module")
def base_url() -> str:
    return _must_env("APP_URL", BASE_URL)


@pytest.fixture(scope="module")
def owner_admin(base_url: str) -> requests.Session:
    """Auth module: owner admin login session."""
    login = _must_env("ADMIN_LOGIN", ADMIN_LOGIN)
    password = _must_env("APP_PASSWORD", APP_PASSWORD)
    s = requests.Session()
    r = s.post(
        f"{base_url}/ai-api/auth/login",
        json={"login": login, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert data.get("user", {}).get("role") == "admin"
    return s


@pytest.fixture(scope="module")
def second_admin(owner_admin: requests.Session, base_url: str):
    """Admin users module: create second admin user and cleanup."""
    stamp = int(time.time())
    login = f"iter56admin{stamp}"
    temp_password = f"Iter56-temp-{uuid.uuid4().hex[:10]}"
    final_password = f"Iter56-final-{uuid.uuid4().hex[:10]}"

    plans_r = owner_admin.get(f"{base_url}/admin/api/plans", timeout=30)
    assert plans_r.status_code == 200, plans_r.text
    plans = plans_r.json()
    plan_id = next((p["id"] for p in plans if p.get("name") == "Pro"), plans[0]["id"])

    create_r = owner_admin.post(
        f"{base_url}/admin/api/users",
        json={
            "login": login,
            "name": "Iter56 Second Admin",
            "password": temp_password,
            "role": "admin",
            "planId": plan_id,
            "licenseDays": 30,
        },
        timeout=30,
    )
    assert create_r.status_code == 200, create_r.text
    created = create_r.json()
    uid = created.get("id")
    assert isinstance(uid, str) and uid
    assert created.get("role") == "admin"
    assert created.get("login") == login

    users_r = owner_admin.get(f"{base_url}/admin/api/users", timeout=30)
    assert users_r.status_code == 200, users_r.text
    row = next((u for u in users_r.json() if u.get("id") == uid), None)
    assert row is not None
    assert row.get("login") == login
    assert row.get("role") == "admin"

    yield {
        "uid": uid,
        "login": login,
        "temp_password": temp_password,
        "final_password": final_password,
    }

    owner_admin.delete(f"{base_url}/admin/api/users/{uid}", timeout=30)


@pytest.fixture(scope="module")
def second_admin_session(second_admin: dict, base_url: str) -> requests.Session:
    """Auth module: second admin login with temp password and password change."""
    s = requests.Session()

    first_login = s.post(
        f"{base_url}/ai-api/auth/login",
        json={"login": second_admin["login"], "password": second_admin["temp_password"]},
        timeout=30,
    )
    assert first_login.status_code == 200, first_login.text
    first_user = first_login.json().get("user", {})
    assert first_user.get("id") == second_admin["uid"]
    assert first_user.get("role") == "admin"

    change = s.post(
        f"{base_url}/ai-api/auth/password",
        json={"next": second_admin["final_password"]},
        timeout=30,
    )
    assert change.status_code == 200, change.text
    assert change.json().get("ok") is True

    s2 = requests.Session()
    relogin = s2.post(
        f"{base_url}/ai-api/auth/login",
        json={"login": second_admin["login"], "password": second_admin["final_password"]},
        timeout=30,
    )
    assert relogin.status_code == 200, relogin.text
    user2 = relogin.json().get("user", {})
    assert user2.get("id") == second_admin["uid"]
    assert user2.get("role") == "admin"
    return s2


def test_second_admin_uid_persists_in_session(second_admin_session: requests.Session, second_admin: dict, base_url: str):
    """Session module: UID consistency after temp-password flow."""
    r = second_admin_session.get(f"{base_url}/ai-api/auth/session", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("authed") is True
    assert data.get("user", {}).get("id") == second_admin["uid"]
    assert data.get("user", {}).get("role") == "admin"


def test_shared_file_upload_download_persistence_and_cleanup(
    owner_admin: requests.Session,
    second_admin_session: requests.Session,
    base_url: str,
):
    """Cloud module: owner upload -> second admin download -> persistence GET -> cleanup."""
    payload = b"iter56-shared-file\x00content"
    name = f"iter56-shared-{uuid.uuid4().hex[:8]}.bin"

    upload = owner_admin.post(
        f"{base_url}/ai-api/cloud/upload",
        data={"dir": ""},
        files={"file": (name, io.BytesIO(payload), "application/octet-stream")},
        timeout=30,
    )
    assert upload.status_code == 201, upload.text
    cloud_file = upload.json().get("file", {})
    cloud_id = cloud_file.get("id")
    assert isinstance(cloud_id, str) and cloud_id
    assert cloud_file.get("name") == name

    # Persistence check in owner session
    owner_list = owner_admin.get(f"{base_url}/ai-api/cloud", timeout=30)
    assert owner_list.status_code == 200, owner_list.text
    owner_row = next((f for f in owner_list.json().get("files", []) if f.get("id") == cloud_id), None)
    assert owner_row is not None
    assert owner_row.get("name") == name

    # Access check from separate second-admin session
    second_list = second_admin_session.get(f"{base_url}/ai-api/cloud", timeout=30)
    assert second_list.status_code == 200, second_list.text
    second_row = next((f for f in second_list.json().get("files", []) if f.get("id") == cloud_id), None)
    assert second_row is not None
    assert second_row.get("name") == name

    download = second_admin_session.get(f"{base_url}/ai-api/cloud/file/{cloud_id}", timeout=30)
    assert download.status_code == 200, download.text
    assert download.content == payload

    cleanup = owner_admin.delete(f"{base_url}/ai-api/cloud/file/{cloud_id}", timeout=30)
    assert cleanup.status_code == 200, cleanup.text

    deleted = owner_admin.get(f"{base_url}/ai-api/cloud/file/{cloud_id}", timeout=30)
    assert deleted.status_code == 404
