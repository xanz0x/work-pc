"""Временная почта · реальная ДОСТАВКА письма на адрес mail.tm (@uberip.com).

Способ доставки: прямое SMTP-соединение с MX-сервером домена (in.mail.tm:25).
Порт 25 из пода открыт, mail.tm принимает письма без авторизации/SPF.
Проверяем: письмо появляется в GET /ai-api/mail/temp/:id/inbox (rows/count),
открывается через /messages/:mid (тема, отправитель, тело) и из тела
извлекается код подтверждения (для кнопки mail-temp-code).
"""

import os
import smtplib
import time
import uuid
from email.message import EmailMessage

import pytest
import requests

APP_URL = os.environ.get("APP_URL", "https://layout-perfect-4.preview.emergentagent.com").rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")
LOGIN = os.environ.get("ADMIN_LOGIN", "admin")
API = f"{APP_URL}/ai-api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"X-Forwarded-For": "203.0.113.77"})
    r = s.post(f"{API}/auth/login", json={"login": LOGIN, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text[:300]}"
    return s


@pytest.fixture(scope="module")
def box(client):
    """Берём уже существующий mailtm-ящик, иначе создаём новый."""
    r = client.get(f"{API}/mail/temp", timeout=30)
    assert r.status_code == 200, r.text[:300]
    boxes = [b for b in r.json().get("boxes", []) if b.get("kind") == "mailtm"]
    if boxes:
        return boxes[0]
    r = client.post(f"{API}/mail/temp", json={"kind": "mailtm"}, timeout=60)
    assert r.status_code in (200, 201), f"create failed {r.status_code}: {r.text[:300]}"
    return r.json()["box"]


def _send(to_addr: str, subject: str, body: str) -> str:
    msg = EmailMessage()
    msg["From"] = "qa-bot@uberip-qa.example.com"
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg["Message-ID"] = f"<{uuid.uuid4()}@uberip-qa.example.com>"
    msg.set_content(body)
    with smtplib.SMTP("in.mail.tm", 25, timeout=45) as smtp:
        smtp.ehlo("uberip-qa.example.com")
        smtp.send_message(msg)
    return subject


class TestTempInboxContract:
    """Контракт входящих временного ящика."""

    def test_inbox_returns_rows_and_count(self, client, box):
        r = client.get(f"{API}/mail/temp/{box['id']}/inbox", timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data.get("rows"), list)
        assert isinstance(data["box"]["count"], int)
        assert data["box"]["count"] == len(data["rows"])
        assert data["box"]["lastSyncAt"]
        assert "secretEnc" not in data["box"] and "accountId" not in data["box"]
        assert "_id" not in data["box"]


class TestRealDelivery:
    """БАГ 2 · доставка настоящего письма и его чтение."""

    def test_deliver_and_read(self, client, box):
        code = "482913"
        subject = f"TEST_QA verification {uuid.uuid4().hex[:6]}"
        body = f"Hello!\nYour verification code is {code}\nIgnore if not you."
        try:
            _send(box["address"], subject, body)
        except Exception as exc:  # noqa: BLE001
            pytest.fail(f"SMTP delivery to in.mail.tm:25 failed: {exc}")

        found = None
        deadline = time.time() + 90
        while time.time() < deadline and not found:
            time.sleep(5)
            r = client.get(f"{API}/mail/temp/{box['id']}/inbox", timeout=60)
            assert r.status_code == 200, r.text[:300]
            rows = r.json().get("rows", [])
            found = next((x for x in rows if x.get("subject") == subject), None)
        assert found, f"письмо '{subject}' не появилось во входящих за 90 с"
        assert found["mid"]
        assert "uberip-qa.example.com" in found["from"] or found["from"] != "—"
        assert found["date"]

        # count синхронизирован
        r = client.get(f"{API}/mail/temp/{box['id']}/inbox", timeout=60)
        data = r.json()
        assert data["box"]["count"] == len(data["rows"]) >= 1

        # открытие письма
        m = client.get(f"{API}/mail/temp/{box['id']}/messages/{found['mid']}", timeout=60)
        assert m.status_code == 200, m.text[:300]
        full = m.json()["message"]
        assert full["subject"] == subject
        assert code in ((full.get("html") or "") + (full.get("text") or ""))
        assert full["date"]

    def test_message_bad_mid(self, client, box):
        r = client.get(f"{API}/mail/temp/{box['id']}/messages/%20%20", timeout=30)
        assert r.status_code in (400, 404), r.status_code
