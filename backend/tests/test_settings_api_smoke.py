"""Settings/API smoke checks for auth-backed settings integrations."""

import os

import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("APP_URL")
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN")
APP_PASSWORD = os.environ.get("APP_PASSWORD")


if not BASE_URL:
    pytest.skip("BASE_URL env is missing", allow_module_level=True)


@pytest.fixture(scope="module")
def authed_session():
    """Auth module: login + session cookie bootstrap."""
    if not ADMIN_LOGIN or not APP_PASSWORD:
        pytest.skip("ADMIN_LOGIN/APP_PASSWORD missing")

    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    response = session.post(
        f"{BASE_URL.rstrip('/')}/ai-api/auth/login",
        json={"login": ADMIN_LOGIN, "password": APP_PASSWORD},
        timeout=25,
    )
    assert response.status_code == 200
    data = response.json()
    assert data.get("ok") is True
    assert data.get("user", {}).get("login") == ADMIN_LOGIN
    return session


def test_auth_session_persistence(authed_session):
    """Auth module: verify authenticated session is persisted."""
    response = authed_session.get(f"{BASE_URL.rstrip('/')}/ai-api/auth/session", timeout=25)
    assert response.status_code == 200
    data = response.json()
    assert data.get("authed") is True
    assert data.get("user", {}).get("login") == ADMIN_LOGIN


def test_cloud_view_endpoint_is_not_5xx(authed_session):
    """Cloud section module: endpoint is healthy for settings rendering."""
    response = authed_session.get(f"{BASE_URL.rstrip('/')}/ai-api/cloud", timeout=25)
    assert response.status_code < 500
    if response.status_code == 200:
        data = response.json()
        assert isinstance(data, dict)
        assert "folders" in data


def test_mcp_list_endpoint_is_not_5xx(authed_session):
    """MCP section module: admin listing endpoint responds without server error."""
    response = authed_session.get(f"{BASE_URL.rstrip('/')}/ai-api/mcp", timeout=25)
    assert response.status_code < 500
    if response.status_code == 200:
        data = response.json()
        assert isinstance(data, list)
