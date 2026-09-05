"""
Iteration 32 · Proton bridge/alt flows + bridge port validation.
Прогон: APP_URL=https://layout-perfect-4.preview.emergentagent.com \
        python -m pytest tests/api/test_mail_proton_iter32.py -v
"""
import os
import time
import pytest
import requests

BASE = os.environ.get("APP_URL", "https://layout-perfect-4.preview.emergentagent.com").rstrip("/")
ADMIN_PASS = "IceKrymTeam13@"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return s


# ---------- Discover ----------

def test_discover_proton_has_bridge_and_alt(admin):
    r = admin.post(f"{BASE}/ai-api/mail/discover", json={"email": "someone@proton.me"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["provider"]["id"] == "proton"
    assert d["hint"]["kind"] == "bridge"
    # candidates[0] должен быть builtin с 127.0.0.1:1025/1143
    c0 = d["candidates"][0]
    assert c0["source"] == "builtin"
    assert c0["config"]["smtp"]["host"] == "127.0.0.1"
    assert c0["config"]["smtp"]["port"] == 1025
    assert c0["config"]["imap"]["host"] == "127.0.0.1"
    assert c0["config"]["imap"]["port"] == 1143
    # bridge probe
    assert "bridge" in d
    b = d["bridge"]
    assert b["reachable"] is False
    assert b["smtp"] is False
    assert b["imap"] is False
    assert isinstance(b["serverHost"], str) and len(b["serverHost"]) > 0
    # alt (SMTP-токен)
    assert "alt" in d
    alt = d["alt"]
    assert alt["id"] == "proton-token"
    assert alt["config"]["smtp"]["host"] == "smtp.protonmail.ch"
    assert alt["config"]["smtp"]["port"] == 587
    assert alt["config"]["smtp"]["security"] == "starttls"
    assert alt["config"]["imap"] is None
    assert "SMTP-токен" in alt["label"] or "SMTP" in alt["label"]


def test_discover_gmail_has_no_bridge_or_alt(admin):
    r = admin.post(f"{BASE}/ai-api/mail/discover", json={"email": "user@gmail.com"}, timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d["provider"]["id"] == "gmail"
    assert d.get("bridge") is None or "bridge" not in d
    assert d.get("alt") is None or "alt" not in d


# ---------- Accounts POST · Proton scenarios ----------

def test_proton_default_no_config_returns_needs_bridge(admin):
    r = admin.post(
        f"{BASE}/ai-api/mail/accounts",
        json={"name": "TEST_ProtonBridge", "email": "someone@proton.me", "password": "p"},
        timeout=30,
    )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body.get("code") == "NEEDS_BRIDGE", body
    assert "127.0.0.1" in str(body)


def test_proton_token_mode_bad_token_returns_auth_failed(admin):
    payload = {
        "name": "TEST_ProtonToken",
        "email": "someone@proton.me",
        "password": "bad",
        "config": {
            "smtp": {"host": "smtp.protonmail.ch", "port": 587, "security": "starttls"},
            "imap": None,
            "bridge": False,
        },
    }
    r = admin.post(f"{BASE}/ai-api/mail/accounts", json=payload, timeout=30)
    assert r.status_code == 422, r.text
    body = r.json()
    assert body.get("code") == "AUTH_FAILED", body
    txt = str(body).lower()
    assert "smtp" in txt or "токен" in txt or "token" in txt


def test_bridge_ports_without_bridge_flag_rejected(admin):
    payload = {
        "name": "TEST_BridgeNoFlag",
        "email": "someone@proton.me",
        "password": "p",
        "config": {
            "smtp": {"host": "10.0.0.5", "port": 1025, "security": "starttls"},
            "imap": {"host": "10.0.0.5", "port": 1143, "security": "starttls"},
        },
    }
    r = admin.post(f"{BASE}/ai-api/mail/accounts", json=payload, timeout=30)
    assert r.status_code == 400, r.text
    assert r.json().get("code") == "INVALID_ARGS", r.text


def test_bridge_ports_with_bridge_flag_accepted_for_validation(admin):
    """С флагом bridge:true — порты 1025/1143 разрешены; ошибка идёт от соединения (422), не 400."""
    payload = {
        "name": "TEST_BridgeFlag",
        "email": "someone@proton.me",
        "password": "p",
        "config": {
            "smtp": {"host": "10.0.0.5", "port": 1025, "security": "starttls"},
            "imap": {"host": "10.0.0.5", "port": 1143, "security": "starttls"},
            "bridge": True,
        },
    }
    t0 = time.time()
    r = admin.post(f"{BASE}/ai-api/mail/accounts", json=payload, timeout=60)
    dur = time.time() - t0
    assert r.status_code != 400, f"port validation should pass with bridge:true, got 400 {r.text}"
    assert r.status_code == 422, r.text
    code = r.json().get("code")
    assert code in ("NEEDS_BRIDGE", "CONNECT_FAILED"), r.text
    assert dur < 40, f"too slow: {dur}s"
