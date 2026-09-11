"""Длинное письмо на адрес mail.tm — для проверки прокрутки открытого письма.

Запуск: python3 scripts/qa-send-long-mail.py <адрес@uberip.com>
"""

import smtplib
import sys
import uuid
from email.message import EmailMessage

TO = sys.argv[1]
BLOCKS = "\n".join(
    f'<p style="font-size:16px">Абзац {i}: длинное письмо для проверки прокрутки. '
    f'Строка {i} из 60, текст занимает несколько экранов.</p>'
    for i in range(1, 61)
)
HTML = f'<html><body style="overflow:hidden;height:100%"><h1>Длинное письмо</h1>{BLOCKS}<p id="tail">КОНЕЦ ПИСЬМА · 999111</p></body></html>'

msg = EmailMessage()
msg["From"] = "qa-bot@uberip-qa.example.com"
msg["To"] = TO
msg["Subject"] = "Проверка прокрутки: длинное письмо"
msg["Message-ID"] = f"<{uuid.uuid4()}@uberip-qa.example.com>"
msg.set_content("Длинное письмо, текстовая часть")
msg.add_alternative(HTML, subtype="html")

with smtplib.SMTP("in.mail.tm", 25, timeout=30) as s:
    s.send_message(msg)
print("sent to", TO)
