"""Доставка тестового письма с CTA, текстом и картинкой на адрес mail.tm.

Запуск: python3 scripts/qa-send-rich-mail.py <адрес@uberip.com>
Способ: прямое SMTP-соединение с MX домена (in.mail.tm:25) — как в
tests/api/test_mail_temp_delivery.py. Нужен только для ручных/E2E проверок
контекстного меню внутри письма.
"""

import smtplib
import sys
import uuid
from email.message import EmailMessage

TO = sys.argv[1]
SUBJECT = sys.argv[2] if len(sys.argv) > 2 else "Проверка меню: кнопка, текст и картинка"

HTML = """<html><body>
<p id="lead">Обычный абзац письма: правый клик по этому тексту должен открыть меню.</p>
<p><a id="cta" href="https://example.com/confirm?code=778899"
   style="display:inline-block;padding:12px 22px;background:#1a5fb4;color:#fff;
          text-decoration:none;border-radius:8px;font-weight:700">Подтвердить регистрацию</a></p>
<p><img id="pic" src="https://picsum.photos/id/1025/320/200" width="320" height="200" alt="Картинка письма"></p>
<p>Код подтверждения: 778899</p>
</body></html>"""

msg = EmailMessage()
msg["From"] = "qa-bot@uberip-qa.example.com"
msg["To"] = TO
msg["Subject"] = SUBJECT
msg["Message-ID"] = f"<{uuid.uuid4()}@uberip-qa.example.com>"
msg.set_content("Обычный абзац письма. Код подтверждения: 778899")
msg.add_alternative(HTML, subtype="html")

with smtplib.SMTP("in.mail.tm", 25, timeout=45) as smtp:
    smtp.ehlo("uberip-qa.example.com")
    smtp.send_message(msg)

print(f"sent -> {TO}: {SUBJECT}")
