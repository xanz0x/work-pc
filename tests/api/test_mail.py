"""Модуль «Почта» — MVP (phase 1) API-регресс.

Прогон: APP_URL=https://inbox-sync-15.preview.emergentagent.com \
        python3 -m pytest tests/api/test_mail.py -q
"""
import os
import time
import uuid

import pytest
import requests

BASE = os.environ.get("APP_URL", "https://inbox-sync-15.preview.emergentagent.com").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")

ETHEREAL_EMAIL = "dzzbuk33bcyzyoqm@ethereal.email"
ETHEREAL_PASS = "22FNUDY5JhDHu75uaE"


# --- auth fixtures ---

@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"login": "admin", "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup_accounts(admin):
    """Snapshot the accounts before tests; delete anything created during the run at teardown."""
    before = {a["id"] for a in admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json().get("accounts", [])}
    yield
    try:
        after = admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json().get("accounts", [])
        for a in after:
            if a["id"] not in before:
                admin.delete(f"{BASE}/ai-api/mail/accounts/{a['id']}", timeout=15)
    except Exception:  # noqa: BLE001
        pass


# --- auth guard ---

def test_unauth_accounts_returns_401():
    r = requests.get(f"{BASE}/ai-api/mail/accounts", timeout=15)
    assert r.status_code == 401, r.text


# --- discovery ---

def test_discover_gmail_builtin(admin):
    r = admin.post(f"{BASE}/ai-api/mail/discover", json={"email": "someone@gmail.com"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d.get("provider") or {}).get("id") == "gmail"
    assert d.get("hint", {}).get("kind") == "app-password"
    c0 = d["candidates"][0]
    assert c0["source"] == "builtin"
    smtp, imap = c0["config"]["smtp"], c0["config"]["imap"]
    assert smtp["host"] == "smtp.gmail.com" and smtp["port"] == 465 and smtp["security"] == "ssl"
    assert imap["host"] == "imap.gmail.com" and imap["port"] == 993


def test_discover_proton_bridge(admin):
    r = admin.post(f"{BASE}/ai-api/mail/discover", json={"email": "someone@proton.me"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("hint", {}).get("kind") == "bridge"
    c0 = d["candidates"][0]
    assert c0["config"]["smtp"]["host"] == "127.0.0.1" and c0["config"]["smtp"]["port"] == 1025


def test_discover_hotmail_oauth(admin):
    r = admin.post(f"{BASE}/ai-api/mail/discover", json={"email": "user@hotmail.com"}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json().get("hint", {}).get("kind") == "oauth"


def test_discover_ethereal_srv(admin):
    r = admin.post(f"{BASE}/ai-api/mail/discover", json={"email": ETHEREAL_EMAIL}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    cand = next((c for c in d.get("candidates", []) if c.get("config", {}).get("smtp", {}).get("host") == "smtp.ethereal.email"), None)
    assert cand is not None, d
    assert cand["source"] == "srv"
    assert cand["config"]["smtp"]["port"] == 587 and cand["config"]["smtp"]["security"] == "starttls"
    assert cand["config"]["imap"]["host"] == "imap.ethereal.email" and cand["config"]["imap"]["port"] == 993 and cand["config"]["imap"]["security"] == "ssl"


def test_discover_invalid_email(admin):
    r = admin.post(f"{BASE}/ai-api/mail/discover", json={"email": "not-an-email"}, timeout=15)
    assert r.status_code == 400
    assert r.json().get("code") == "INVALID_ARGS"


# --- create account (real ethereal) ---

@pytest.fixture(scope="module")
def ethereal_account(admin):
    payload = {"name": "Ethereal-pytest", "email": ETHEREAL_EMAIL, "password": ETHEREAL_PASS}
    r = admin.post(f"{BASE}/ai-api/mail/accounts", json=payload, timeout=60)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["ok"] is True
    acc = data["account"]
    assert len(acc["id"]) == 8 and all(c in "0123456789abcdef" for c in acc["id"])
    assert acc["status"]["smtp"] == "ok"
    assert acc["status"]["imap"] == "ok"
    assert acc.get("hasPassword") is True
    assert "passwordEnc" not in acc and "password" not in acc
    assert data["checks"]["smtp"] == "ok" and data["checks"]["imap"] == "ok"
    assert data.get("source") == "srv"
    return acc


def test_ethereal_account_created(ethereal_account):
    assert ethereal_account["email"] == ETHEREAL_EMAIL


def test_list_accounts_no_password_fields(admin, ethereal_account):
    r = admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("enabled") is True
    accs = body.get("accounts", [])
    ours = next((a for a in accs if a["id"] == ethereal_account["id"]), None)
    assert ours is not None
    assert "password" not in ours and "passwordEnc" not in ours
    assert ours.get("hasPassword") is True


def test_gmail_wrong_password_not_saved(admin):
    # unique email → own rate-limit bucket
    email = f"qa-{uuid.uuid4().hex[:6]}@gmail.com"
    before = {a["id"] for a in admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json()["accounts"]}
    r = admin.post(f"{BASE}/ai-api/mail/accounts",
                   json={"name": "Bad", "email": email, "password": "not-a-real-password"}, timeout=45)
    assert r.status_code == 422, r.text
    b = r.json()
    assert b.get("ok") is False
    assert b.get("code") == "NEEDS_APP_PASSWORD"
    assert b.get("hint", {}).get("url")
    assert b.get("candidate") is not None
    assert b.get("checks", {}).get("smtp") == "fail"
    after = {a["id"] for a in admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json()["accounts"]}
    assert after == before


def test_manual_config_disallowed_port(admin):
    r = admin.post(f"{BASE}/ai-api/mail/accounts", json={
        "name": "M", "email": f"qa-{uuid.uuid4().hex[:6]}@example.com", "password": "x",
        "config": {"smtp": {"host": "smtp.example.com", "port": 2525, "security": "ssl"}, "imap": None},
    }, timeout=15)
    assert r.status_code == 400
    assert r.json().get("code") == "INVALID_ARGS"


def test_manual_config_security_none_non_loopback(admin):
    r = admin.post(f"{BASE}/ai-api/mail/accounts", json={
        "name": "M", "email": f"qa-{uuid.uuid4().hex[:6]}@example.com", "password": "x",
        "config": {"smtp": {"host": "smtp.example.com", "port": 25, "security": "none"}, "imap": None},
    }, timeout=15)
    assert r.status_code == 400
    assert r.json().get("code") == "INVALID_ARGS"


# --- test / rename / bad-password update ---

def test_reverify(admin, ethereal_account):
    r = admin.post(f"{BASE}/ai-api/mail/accounts/{ethereal_account['id']}/test", timeout=45)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["checks"]["smtp"] == "ok" and b["checks"]["imap"] == "ok"


def test_rename(admin, ethereal_account):
    r = admin.put(f"{BASE}/ai-api/mail/accounts/{ethereal_account['id']}",
                  json={"name": "Renamed-pytest"}, timeout=45)
    assert r.status_code == 200, r.text
    assert r.json()["account"]["name"] == "Renamed-pytest"


def test_bad_password_kept_old(admin, ethereal_account):
    r = admin.put(f"{BASE}/ai-api/mail/accounts/{ethereal_account['id']}",
                  json={"password": "definitely-wrong-password"}, timeout=45)
    assert r.status_code == 422, r.text
    # subsequent /test still ok with old password
    time.sleep(1)
    r2 = admin.post(f"{BASE}/ai-api/mail/accounts/{ethereal_account['id']}/test", timeout=45)
    assert r2.status_code == 200
    assert r2.json()["checks"]["smtp"] == "ok"


def test_put_nonexistent(admin):
    r = admin.put(f"{BASE}/ai-api/mail/accounts/deadbeef", json={"name": "x"}, timeout=15)
    assert r.status_code == 404


# --- send ---

def test_send_ok(admin, ethereal_account):
    before = admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json()["accounts"]
    before_sent = next(a for a in before if a["id"] == ethereal_account["id"]).get("sentCount", 0)
    r = admin.post(f"{BASE}/ai-api/mail/accounts/{ethereal_account['id']}/send", json={
        "to": ETHEREAL_EMAIL,
        "subject": "pytest",
        "text": "hello",
        "attachments": [{"name": "a.txt", "type": "text/plain", "dataBase64": "aGVsbG8="}],
    }, timeout=45)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["ok"] is True and b.get("messageId") and b["recipients"] == 1
    after = admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json()["accounts"]
    after_sent = next(a for a in after if a["id"] == ethereal_account["id"]).get("sentCount", 0)
    assert after_sent == before_sent + 1


def test_send_empty_body(admin, ethereal_account):
    r = admin.post(f"{BASE}/ai-api/mail/accounts/{ethereal_account['id']}/send", json={
        "to": ETHEREAL_EMAIL,
    }, timeout=15)
    assert r.status_code == 400


def test_send_invalid_to(admin, ethereal_account):
    r = admin.post(f"{BASE}/ai-api/mail/accounts/{ethereal_account['id']}/send", json={
        "to": "not-an-email", "subject": "x", "text": "y",
    }, timeout=15)
    assert r.status_code == 400


# --- delete + rate-limit (rate-limit last) ---

def test_delete_and_double(admin):
    # create a throwaway ethereal account (reuse same creds, second account entry gets a new id)
    r = admin.post(f"{BASE}/ai-api/mail/accounts",
                   json={"name": "Throwaway", "email": ETHEREAL_EMAIL, "password": ETHEREAL_PASS}, timeout=60)
    # ethereal creds allow multiple accounts; if server dedupes by email skip
    if r.status_code != 201:
        pytest.skip(f"cannot create throwaway account: {r.status_code} {r.text[:120]}")
    aid = r.json()["account"]["id"]
    r1 = admin.delete(f"{BASE}/ai-api/mail/accounts/{aid}", timeout=15)
    assert r1.status_code == 200 and r1.json().get("ok") is True
    r2 = admin.delete(f"{BASE}/ai-api/mail/accounts/{aid}", timeout=15)
    assert r2.status_code == 404


def test_zzz_rate_limit_last(admin):
    """Rate-limit is per uid:email — use a distinct email so it doesn't affect other tests."""
    email = "ratelimit-qa@gmail.com"
    hit = False
    for _ in range(7):
        r = admin.post(f"{BASE}/ai-api/mail/accounts",
                       json={"name": "RL", "email": email, "password": "wrong"}, timeout=45)
        if r.status_code == 429:
            assert r.json().get("code") == "RATE_LIMITED"
            hit = True
            break
    assert hit, "expected 429 RATE_LIMITED after ≤7 attempts"
