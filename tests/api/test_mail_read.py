"""Модуль «Почта» — фаза 2 (чтение по IMAP): папки, список, письмо, флаги, лимиты, ошибки.

Прогон: APP_URL=https://inbox-sync-15.preview.emergentagent.com \
        python3 -m pytest tests/api/test_mail_read.py -q
Ящик Ethereal поддерживает IMAP; письма туда попадают только через его же SMTP (self-send).
"""
import os
import time

import pytest
import requests

BASE = os.environ.get("APP_URL", "https://inbox-sync-15.preview.emergentagent.com").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")

ETHEREAL_EMAIL = "qtf2kannuu6gjlxb@ethereal.email"
ETHEREAL_PASS = "2T6upz7zfYqNGbAGRs"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"login": "admin", "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def account(admin):
    """Ящик Ethereal на время модуля: переиспользуем существующий, иначе создаём и в конце удаляем."""
    existing = [a for a in admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json()["accounts"] if a["email"] == ETHEREAL_EMAIL]
    if existing:
        yield existing[0]
        return
    r = admin.post(f"{BASE}/ai-api/mail/accounts", json={"name": "Read QA", "email": ETHEREAL_EMAIL, "password": ETHEREAL_PASS}, timeout=60)
    assert r.status_code == 200 and r.json().get("ok"), r.text
    acc = r.json()["account"]
    assert acc["imap"], "IMAP должен быть найден автопоиском"
    yield acc
    admin.delete(f"{BASE}/ai-api/mail/accounts/{acc['id']}", timeout=15)


@pytest.fixture(scope="module")
def seeded(admin, account):
    """Гарантируем хотя бы одно письмо во «Входящих» (отправка себе через Ethereal SMTP)."""
    page = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX"}, timeout=60).json()
    if page.get("total", 0) > 0:
        return page
    r = admin.post(
        f"{BASE}/ai-api/mail/accounts/{account['id']}/send",
        json={"to": ETHEREAL_EMAIL, "subject": "QA phase 2", "text": "Привет из теста чтения", "html": "<p>Привет <b>из теста</b><script>alert(1)</script></p>"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    for _ in range(10):
        time.sleep(2)
        page = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX"}, timeout=60).json()
        if page.get("total", 0) > 0:
            return page
    pytest.fail("письмо не появилось во «Входящих» Ethereal")


# --- guards ---

def test_unauth_folders_401(account):
    r = requests.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/folders", timeout=15)
    assert r.status_code == 401


def test_unknown_account_404(admin):
    r = admin.get(f"{BASE}/ai-api/mail/accounts/00000000/folders", timeout=15)
    assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"


def test_bad_uid_400(admin, account):
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages/abc", params={"folder": "INBOX"}, timeout=15)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_ARGS"


def test_bad_cursor_400(admin, account):
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX", "cursor": "-1"}, timeout=15)
    assert r.status_code == 400


def test_flags_without_body_400(admin, account):
    r = admin.post(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages/1/flags", json={"folder": "INBOX"}, timeout=15)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_ARGS"


# --- folders ---

def test_folders_inbox_first_with_counters(admin, account):
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/folders", timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["folders"][0]["path"] == "INBOX"
    inbox = d["folders"][0]
    assert isinstance(inbox["total"], int) and isinstance(inbox["unseen"], int)
    assert isinstance(d["syncedAt"], int)
    # карточка ящика стала «живой»
    acc = next(a for a in admin.get(f"{BASE}/ai-api/mail/accounts", timeout=15).json()["accounts"] if a["id"] == account["id"])
    assert acc["status"]["imap"] == "ok"
    assert acc["imapSync"]["total"] == inbox["total"] and acc["imapSync"]["unseen"] == inbox["unseen"]
    assert "passwordEnc" not in acc


def test_unknown_folder_404(admin, account):
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "NoSuchFolderQA"}, timeout=60)
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "NOT_FOUND"


# --- messages ---

def test_messages_page_shape(admin, account, seeded):
    page = seeded
    assert page["folder"] == "INBOX" and page["total"] >= 1
    rows = page["rows"]
    assert len(rows) == min(page["total"], 30)
    assert rows == sorted(rows, key=lambda r: -r["seq"]), "новые сверху"
    row = rows[0]
    for k in ("uid", "seq", "subject", "from", "to", "date", "size", "seen", "flagged", "answered", "hasAttachments"):
        assert k in row
    assert page["nextCursor"] is None if page["total"] <= 30 else page["nextCursor"] > 0


def test_messages_limit_and_cursor(admin, account, seeded):
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX", "limit": 1}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["rows"]) == 1
    if d["total"] > 1:
        assert d["nextCursor"] == d["rows"][0]["seq"]
        r2 = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX", "limit": 1, "cursor": d["nextCursor"]}, timeout=60)
        assert r2.json()["rows"][0]["seq"] == d["rows"][0]["seq"] - 1
    else:
        assert d["nextCursor"] is None


def test_message_body_and_seen(admin, account, seeded):
    uid = seeded["rows"][0]["uid"]
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages/{uid}", params={"folder": "INBOX"}, timeout=60)
    assert r.status_code == 200, r.text
    m = r.json()["message"]
    assert m["uid"] == uid and m["folder"] == "INBOX"
    assert m["seen"] is True, "открытие помечает письмо прочитанным"
    assert (m["html"] is not None) or (m["text"] is not None)
    if m["html"]:
        assert "<script" not in m["html"].lower()
    assert isinstance(m["attachments"], list)
    for a in m["attachments"]:
        assert set(a) >= {"filename", "contentType", "size"}


def test_message_not_found_404(admin, account):
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages/4000000000", params={"folder": "INBOX"}, timeout=60)
    assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"


def test_flags_roundtrip(admin, account, seeded):
    uid = seeded["rows"][0]["uid"]
    url = f"{BASE}/ai-api/mail/accounts/{account['id']}/messages/{uid}/flags"
    r = admin.post(url, json={"folder": "INBOX", "flagged": True, "seen": False}, timeout=60)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "uid": uid, "seen": False, "flagged": True}
    rows = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX"}, timeout=60).json()["rows"]
    row = next(x for x in rows if x["uid"] == uid)
    assert row["flagged"] is True and row["seen"] is False
    r = admin.post(url, json={"folder": "INBOX", "flagged": False, "seen": True}, timeout=60)
    assert r.json()["flagged"] is False and r.json()["seen"] is True


def test_messages_with_folders_single_connection(admin, account, seeded):
    """withFolders=1 — папки в том же ответе; для полностью загруженной папки unseen совпадает со строками."""
    r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX", "withFolders": "1"}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["folders"][0]["path"] == "INBOX"
    if d["nextCursor"] is None:
        assert d["folders"][0]["unseen"] == sum(1 for x in d["rows"] if not x["seen"])
    r2 = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "INBOX"}, timeout=60)
    assert "folders" not in r2.json()


def test_read_rate_limit_60_per_minute(admin, account):
    """Лимит считает и отклонённые запросы: бьём в 404-папку, чтобы не ждать IMAP."""
    hit = None
    for _ in range(70):
        r = admin.get(f"{BASE}/ai-api/mail/accounts/{account['id']}/messages", params={"folder": "\n"}, timeout=15)
        if r.status_code == 429:
            hit = r
            break
    assert hit is not None, "429 не наступил за 70 запросов"
    assert hit.json()["code"] == "RATE_LIMITED" and hit.json()["retryAfter"] >= 1
