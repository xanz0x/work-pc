"""NF-10 · MCP наружу: токены, области, аудит, подтверждения.

Прогон: APP_URL=https://<preview> python3 -m pytest tests/api/test_mcp.py -q
Без открытой вкладки WorkSpaceX инструменты отвечают NO_BRIDGE — это ожидаемо
и тоже проверяется: сервер не выдумывает данные, которых у него нет.
"""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("APP_URL", os.environ.get("WF_BASE", "http://localhost:3000")).rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")


@pytest.fixture(scope="module")
def authed():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def token(authed):
    r = authed.post(
        f"{BASE}/mcp/admin/tokens",
        json={"name": f"pytest-{uuid.uuid4().hex[:4]}", "scopes": ["search", "read"], "ttlHours": 1},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"].startswith("wsx_")
    assert "hash" not in body["view"]
    return body


def rpc(tok, method, params=None, id_=1):
    return requests.post(
        f"{BASE}/mcp",
        json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}},
        headers={"Authorization": f"Bearer {tok}", "Accept": "application/json, text/event-stream"},
        timeout=40,
    )


def test_admin_requires_session():
    assert requests.get(f"{BASE}/mcp/admin/tokens", timeout=15).status_code == 401
    assert requests.get(f"{BASE}/mcp/admin/bridge", timeout=15).status_code == 401
    assert requests.get(f"{BASE}/mcp/admin/pending", timeout=15).status_code == 401


def test_mcp_requires_bearer():
    r = requests.post(f"{BASE}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"}, timeout=15)
    assert r.status_code == 401
    assert "Bearer" in r.headers.get("WWW-Authenticate", "")
    assert r.json()["error"]["message"] == "TOKEN_MISSING"
    bad = rpc("wsx_00000000_" + "0" * 48, "ping")
    assert bad.status_code == 401
    assert bad.json()["error"]["message"] == "TOKEN_INVALID"


def test_get_is_405():
    assert requests.get(f"{BASE}/mcp", timeout=15).status_code == 405


def test_initialize_and_tools_list_filtered_by_scope(token):
    r = rpc(token["token"], "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
    assert r.status_code == 200
    res = r.json()["result"]
    assert res["protocolVersion"] == "2025-06-18"
    assert res["serverInfo"]["name"] == "WorkSpaceX"
    assert "tools" in res["capabilities"]

    names = {t["name"] for t in rpc(token["token"], "tools/list").json()["result"]["tools"]}
    assert names == {"search", "get_metadata", "list_files"}


def test_notification_is_202(token):
    r = requests.post(
        f"{BASE}/mcp",
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={"Authorization": f"Bearer {token['token']}"},
        timeout=15,
    )
    assert r.status_code == 202


def test_scope_denied_is_tool_error(token):
    r = rpc(token["token"], "tools/call", {"name": "create_sticker", "arguments": {"title": "x", "body": "y"}})
    res = r.json()["result"]
    assert res["isError"] is True
    assert res["structuredContent"]["code"] == "SCOPE_DENIED"


def test_invalid_args(token):
    r = rpc(token["token"], "tools/call", {"name": "search", "arguments": {"query": ""}})
    assert r.json()["result"]["structuredContent"]["code"] == "INVALID_ARGS"


def test_unknown_method(token):
    assert rpc(token["token"], "nope").json()["error"]["code"] == -32601


def test_call_without_bridge_or_with(token):
    """Если вкладка не открыта — NO_BRIDGE; если открыта — честный результат поиска."""
    r = rpc(token["token"], "tools/call", {"name": "search", "arguments": {"query": "договор", "limit": 3}})
    res = r.json()["result"]
    sc = res["structuredContent"]
    if res.get("isError"):
        assert sc["code"] in ("NO_BRIDGE", "BRIDGE_TIMEOUT")
    else:
        assert "hits" in sc and isinstance(sc["hits"], list)


def test_secret_write_needs_approval(authed):
    r = authed.post(
        f"{BASE}/mcp/admin/tokens",
        json={"name": "pytest-secrets", "scopes": ["secrets:write"], "ttlHours": 1},
        timeout=15,
    )
    tok = r.json()["token"]
    call = rpc(tok, "tools/call", {
        "name": "create_secret",
        "arguments": {"title": "pytest", "fields": [{"name": "Пароль", "value": "s3cret-value"}]},
    })
    sc = call.json()["result"]["structuredContent"]
    assert sc["status"] == "pending_approval"
    appr = sc["approvalId"]

    pending = authed.get(f"{BASE}/mcp/admin/pending", timeout=15).json()
    mine = [p for p in pending if p["id"] == appr]
    assert mine and "s3cret-value" not in mine[0]["summary"]

    again = rpc(tok, "tools/call", {"name": "create_secret", "arguments": {
        "title": "pytest", "fields": [{"name": "Пароль", "value": "s3cret-value"}], "approvalId": appr}})
    assert again.json()["result"]["structuredContent"]["status"] == "pending_approval"

    rej = authed.post(f"{BASE}/mcp/admin/pending", json={"id": appr, "decision": "reject"}, timeout=15)
    assert rej.status_code == 200
    final = rpc(tok, "tools/call", {"name": "create_secret", "arguments": {
        "title": "pytest", "fields": [{"name": "Пароль", "value": "s3cret-value"}], "approvalId": appr}})
    fr = final.json()["result"]
    assert fr["isError"] is True and fr["structuredContent"]["code"] == "REJECTED"


def test_revoke_then_denied(authed):
    r = authed.post(f"{BASE}/mcp/admin/tokens", json={"name": "pytest-revoke", "scopes": ["search"], "ttlHours": 1}, timeout=15)
    body = r.json()
    assert rpc(body["token"], "ping").status_code == 200
    d = authed.delete(f"{BASE}/mcp/admin/tokens?id={body['view']['id']}", timeout=15)
    assert d.status_code == 200
    denied = rpc(body["token"], "ping")
    assert denied.status_code == 401
    assert denied.json()["error"]["message"] == "TOKEN_REVOKED"
    rows = {t["id"]: t for t in authed.get(f"{BASE}/mcp/admin/tokens", timeout=15).json()}
    assert rows[body["view"]["id"]]["revokedAt"] is not None


def test_token_validation(authed):
    r = authed.post(f"{BASE}/mcp/admin/tokens", json={"name": "x", "scopes": [], "ttlHours": 1}, timeout=15)
    assert r.status_code == 400
    r = authed.post(f"{BASE}/mcp/admin/tokens", json={"name": "x", "scopes": ["search"], "ttlHours": 5}, timeout=15)
    assert r.status_code == 400
