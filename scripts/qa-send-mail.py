"""QA: живая доставка писем на временный ящик mail.tm (SMTP на in.mail.tm:25).

Три письма проверяют новую логику «код/ссылка»:
  1) письмо-подтверждение БЕЗ кода, но с кнопкой (плюс почтовый индекс в подвале);
  2) письмо С кодом и кнопкой;
  3) обычное письмо без кода и без кнопки.
Запуск: python3 scripts/qa-send-mail.py <адрес@uberip.com>
"""

import smtplib
import sys
import uuid
from email.message import EmailMessage

TO = sys.argv[1]

CONFIRM_HTML = """<html><body>
<h1>Confirm your email address.</h1>
<p>Hey Helisu, thanks for signing up for Emergent — we're excited to have you.</p>
<p>Take a second to confirm your email and verify you're the owner of this account.</p>
<table><tr><td bgcolor="#1f6feb" style="border-radius:24px">
<a href="https://smld5lde.r.us-east-1.awstrack.me/L0/https:%2F%2Fapp.emergent.sh%2Fconfirm%3Ft=abc123"
   style="background:#1f6feb;color:#fff;display:inline-block;border-radius:24px;padding:14px 26px">Confirm Email &rarr;</a>
</td></tr></table>
<p>This link expires in 24 hours. If you didn't sign up, nothing changes.</p>
<p>Warmly,<br>The Emergent Team</p>
<p style="color:#888">Emergent Labs, 100 Pine Street, San Francisco, CA 94111</p>
<p><a href="https://app.emergent.sh/unsubscribe?u=778812">Unsubscribe</a></p>
</body></html>"""

CODE_HTML = """<html><body>
<p>Здравствуйте! Ваш код подтверждения:</p>
<p style="font-size:28px"><b>483920</b></p>
<p>Код действует 10 минут.</p>
<a href="https://site.example/verify/zx9" class="btn"
   style="background:#0a7;display:inline-block;border-radius:8px;padding:12px 20px;color:#fff">Подтвердить почту</a>
<p style="color:#888">ООО Пример, индекс 101000</p>
</body></html>"""

PLAIN = "Привет! Просто письмо без кода и без кнопок. Счёт 1 200,50 от 12.03.2026."

LETTERS = [
    ("QA1 Confirm Your Signup", CONFIRM_HTML, "Confirm your email address. Confirm Email https://app.emergent.sh/confirm?t=abc123"),
    ("QA2 Ваш код для входа", CODE_HTML, "Ваш код подтверждения: 483920"),
    ("QA3 Просто письмо", None, PLAIN),
]


def send(subject: str, html: str | None, text: str) -> None:
    msg = EmailMessage()
    msg["From"] = "qa-bot@uberip-qa.example.com"
    msg["To"] = TO
    msg["Subject"] = subject
    msg["Message-ID"] = f"<{uuid.uuid4()}@uberip-qa.example.com>"
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    with smtplib.SMTP("in.mail.tm", 25, timeout=45) as smtp:
        smtp.ehlo("uberip-qa.example.com")
        smtp.send_message(msg)
    print("sent:", subject)


for s, h, t in LETTERS:
    send(s, h, t)
