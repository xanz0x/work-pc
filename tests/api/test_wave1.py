"""Wave-1 backend tests: auth, rate-limit, engine gating, MCP token masking."""
import json
import os
import time
import requests
import pytest

BASE = os.environ.get("WF_BASE", "http://localhost:3000")
PASSWORD = "IceKrymTeam13@"


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


@pytest.fixture(scope="module")
def authed():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD}, timeout=10)
    assert r.status_code == 200, r.text
    assert any("wf_session" in c.name for c in s.cookies)
    return s


# --- Auth gating ---
@pytest.mark.parametrize("path", [
    "/ai-api/skills",
    "/ai-api/sessions",
    "/ai-api/mcp",
    "/ai-api/system",
])
def test_anon_gets_401(anon, path):
    r = anon.get(f"{BASE}{path}")
    assert r.status_code == 401
    body = r.json()
    assert body.get("code") == "AUTH_REQUIRED"


def test_anon_chat_401(anon):
    r = anon.post(f"{BASE}/ai-api/chat", json={"engine": "cloud", "messages": []})
    assert r.status_code == 401
    assert r.json().get("code") == "AUTH_REQUIRED"


def test_login_wrong_password(anon):
    r = anon.post(f"{BASE}/ai-api/auth/login", json={"password": "nope"})
    assert r.status_code == 401
    assert r.json().get("code") == "AUTH_REQUIRED"


def test_login_correct_and_session_and_logout():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD})
    assert r.status_code == 200
    # cookie set
    cookies = {c.name: c for c in s.cookies}
    assert "wf_session" in cookies
    # session says authed
    r2 = s.get(f"{BASE}/ai-api/auth/session")
    assert r2.status_code == 200
    assert r2.json().get("authed") is True
    # skills reachable
    r3 = s.get(f"{BASE}/ai-api/skills")
    assert r3.status_code == 200
    # logout
    r4 = s.delete(f"{BASE}/ai-api/auth/session")
    assert r4.status_code == 200
    # skills 401 again (fresh session, cookies cleared)
    s2 = requests.Session()
    r5 = s2.get(f"{BASE}/ai-api/skills")
    assert r5.status_code == 401


# --- Engine gating ---
def test_chat_local_engine_409(authed):
    r = authed.post(
        f"{BASE}/ai-api/chat",
        json={"engine": "local", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 409
    body = r.json()
    assert body.get("code") == "ENGINE_NOT_CONFIGURED"


# --- Error hygiene: no env names / stack in errors ---
def test_errors_dont_leak_env(anon, authed):
    forbidden = ["AI_PROXY_URL", "EMERGENT_LLM_KEY", "APP_PASSWORD", "Traceback"]
    for r in [
        anon.get(f"{BASE}/ai-api/skills"),
        anon.post(f"{BASE}/ai-api/auth/login", json={"password": "x"}),
        authed.post(f"{BASE}/ai-api/chat", json={"engine": "local", "messages": []}),
    ]:
        txt = r.text
        for f in forbidden:
            assert f not in txt, f"leak of {f} in {r.url}: {txt[:200]}"


# --- MCP token masking ---
def test_mcp_get_does_not_leak_token(authed):
    r = authed.get(f"{BASE}/ai-api/mcp")
    assert r.status_code == 200
    body = r.json()
    # walk and ensure no field named "token" carrying a value
    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "token":
                    assert v in (None, "", False), f"token leaked: {v!r}"
                walk(v)
        elif isinstance(obj, list):
            for x in obj:
                walk(x)
    walk(body)


def test_mcp_put_notion_token_not_persisted(authed):
    r = authed.put(f"{BASE}/ai-api/mcp/notion", json={"token": "ntn_secret_test_xyz"})
    # allow any status; the assertion is on persistence
    r2 = authed.get(f"{BASE}/ai-api/mcp")
    txt = r2.text
    assert "ntn_secret_test_xyz" not in txt
    body = r2.json()
    # find notion node and confirm tokenSet is False
    def find_notion(obj):
        if isinstance(obj, dict):
            if obj.get("id") == "notion" or obj.get("name", "").lower() == "notion":
                return obj
            for v in obj.values():
                x = find_notion(v)
                if x is not None:
                    return x
        elif isinstance(obj, list):
            for v in obj:
                x = find_notion(v)
                if x is not None:
                    return x
        return None
    node = find_notion(body)
    if node is not None and "tokenSet" in node:
        assert node["tokenSet"] is False


# --- Rate limit: последний тест в файле, чтобы не тормозить остальные ---
def test_rate_limit_11th_call_429(authed):
    # fire up to 12 quick local-engine calls (they get 409 but count toward chat rate limit)
    codes = []
    for i in range(12):
        r = authed.post(
            f"{BASE}/ai-api/chat",
            json={"engine": "local", "messages": [{"role": "user", "content": "x"}]},
        )
        codes.append(r.status_code)
        if r.status_code == 429:
            assert r.headers.get("Retry-After") is not None
            assert r.json().get("code") == "RATE_LIMITED"
            break
    assert 429 in codes, f"never hit 429: {codes}"
