# Модуль «Почта» (Mail) · план и инструкция по реализации

Цель: хранить в WorkSpaceX много почтовых ящиков (Gmail, Proton, Яндекс, Mail.ru, Outlook, iCloud, свой домен…),
подключая каждый по трём полям — **название, адрес, пароль**. Параметры SMTP/IMAP приложение находит само.

---

## 1. Как устроен автопоиск настроек (discovery)

Один адрес → домен → цепочка источников, от самого надёжного к догадкам. Останавливаемся на первом,
который дал конфиг, а потом **проверяем его живым соединением** (TLS-handshake + AUTH), прежде чем сохранить.

| # | Источник | Что делаем | Покрытие |
|---|----------|------------|----------|
| 0 | **Встроенная таблица провайдеров** | `gmail.com, googlemail.com, yandex.*, mail.ru/bk.ru/list.ru/inbox.ru, outlook.com/hotmail.*/live.*, icloud.com/me.com, yahoo.*, proton.me/protonmail.*, zoho.*, fastmail.*, gmx.*, rambler.ru` — хосты, порты, тип шифрования, **особые требования** (пароль приложения, OAuth, Bridge) и ссылка «где взять пароль приложения» | 90 % личных ящиков |
| 1 | **Mozilla ISPDB** | `GET https://autoconfig.thunderbird.net/v1.1/{domain}` → XML `clientConfig` (то, чем пользуется Thunderbird) | тысячи провайдеров |
| 2 | **Autoconfig домена** | `https://autoconfig.{domain}/mail/config-v1.1.xml?emailaddress={email}` и `https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml` | хостинги, корп. домены |
| 3 | **DNS SRV (RFC 6186)** | `_imaps._tcp.{domain}`, `_imap._tcp`, `_submissions._tcp` (465), `_submission._tcp` (587) через `dns.promises.resolveSrv` | корп. домены |
| 4 | **MX-эвристика** | `resolveMx(domain)` → если MX указывает на `google.com` → конфиг Gmail (Google Workspace); `outlook.com`/`protection.outlook.com` → Microsoft 365; `yandex.net` → Яндекс 360; `mail.ru` → Mail.ru для бизнеса; `protonmail.ch` → Proton (Bridge) | свои домены на крупных провайдерах |
| 5 | **Microsoft Autodiscover** | `POST https://autodiscover.{domain}/autodiscover/autodiscover.xml` (только если MX → Microsoft) | Exchange/M365 |
| 6 | **Перебор типовых хостов** | `imap.{d}`, `mail.{d}`, `{d}` на 993/143; `smtp.{d}`, `mail.{d}` на 465/587 — TCP-коннект с таймаутом 3 с, проверяем баннер `* OK` / `220` | всё остальное |

Результат discovery — **список кандидатов** с полем `source` (`builtin | ispdb | autoconfig | srv | mx | autodiscover | guess`)
и `confidence`. UI показывает лучший, остальные — в «Дополнительно».

### Особые случаи, которые discovery обязан объяснить пользователю (иначе будет «пароль неверный» без причины)

- **Gmail** — обычный пароль не работает. Нужен **пароль приложения** (2FA обязательна) — ссылка `myaccount.google.com/apppasswords`. Позже: OAuth2 (XOAUTH2) — фаза 3.
- **Proton** — у Proton **нет** публичного IMAP/SMTP. Только через **Proton Bridge** на компьютере пользователя: `127.0.0.1:1143` (IMAP, STARTTLS) и `127.0.0.1:1025` (SMTP, STARTTLS), пароль — тот, что выдаёт Bridge, а не пароль аккаунта. Discovery для `proton.me` возвращает конфиг Bridge + плашку «Установите Proton Bridge». Сертификат Bridge самоподписанный → для `127.0.0.1` разрешаем `rejectUnauthorized: false` только для loopback.
- **Outlook/Hotmail/Live (личные)** — Microsoft отключил Basic Auth для IMAP/SMTP (2024). Работает только OAuth2 → до фазы 3 показываем честное «требуется вход через Microsoft, пока не поддерживается».
- **Яндекс** — нужен пароль приложения (`id.yandex.ru/security/app-passwords`) и включённый IMAP в настройках почты.
- **Mail.ru** — пароль для внешних приложений (`id.mail.ru/security`).
- **iCloud** — пароль для приложения (`appleid.apple.com` → «Пароли приложений»).
- **Yahoo** — пароль приложения.

Таблица провайдеров хранит поле `authHint: { kind: 'app-password' | 'oauth' | 'bridge' | 'plain', url, text }`.

---

## 2. Хранение

Сервер (Next.js) должен **сам** подключаться к SMTP/IMAP, значит пароль нужен ему в открытом виде в момент отправки.
Поэтому ящики живут не в E2EE-сейфе браузера, а на сервере, зашифрованные серверным ключом.

- Файл: `AI_DIR/users/<uid>/mail/accounts.json` (у legacy-админа — `AI_DIR/mail/accounts.json`), как остальные пер-пользовательские данные.
- Пароль: `AES-256-GCM`, ключ выводится через `scrypt` из `MAIL_SECRET` (новая переменная `.env`, 32+ байта). Без переменной модуль отключён и честно об этом говорит.
- В API пароль **никогда не возвращается** — только `hasPassword: true`.
- Модель записи:

```ts
type MailAccount = {
  id: string                 // 8 hex
  name: string               // «Рабочая», «Claude на ноутбуке»
  email: string
  provider: string           // 'gmail' | 'yandex' | 'custom' …
  smtp: { host: string; port: number; security: 'ssl' | 'starttls' | 'none' }
  imap: { host: string; port: number; security: 'ssl' | 'starttls' | 'none' } | null
  user: string               // логин, обычно = email
  passwordEnc: string        // iv:tag:ciphertext, base64
  discovery: { source: string; at: number }
  status: { smtp: 'ok' | 'fail' | 'unknown'; imap: 'ok' | 'fail' | 'unknown'; checkedAt: number; error?: string }
  createdAt: number
}
```

---

## 3. Библиотеки (единственное отступление от «zero-dependency»)

Писать свой SMTP/IMAP-клиент с TLS, SASL и MIME — неоправданно. Предлагаю ровно две зависимости, обе — стандарт де-факто, без транзитивного мусора:

- `nodemailer` — SMTP (STARTTLS/SSL, AUTH PLAIN/LOGIN/XOAUTH2, `verify()` для проверки подключения).
- `imapflow` — IMAP (фаза 2: список писем, чтение, флаги). Плюс `mailparser` для разбора MIME.

Discovery (HTTP, DNS, TCP-пробы) — только встроенные `fetch`, `node:dns`, `node:tls`/`node:net`.

---

## 4. API (все маршруты под сессией через `proxy.ts`, префикс `/ai-api/mail`)

| Метод | Путь | Назначение |
|------|------|-----------|
| POST | `/ai-api/mail/discover` | `{ email }` → `{ candidates: [...], provider, authHint }` — без пароля, быстро (< 5 с, параллельные источники с таймаутами) |
| GET | `/ai-api/mail/accounts` | список ящиков (без паролей) |
| POST | `/ai-api/mail/accounts` | `{ name, email, password, config? }` — если `config` не передан, сервер сам делает discovery, затем **проверяет SMTP `verify()` и IMAP login**, сохраняет только при успехе; при провале — `{ code: 'AUTH_FAILED' | 'CONNECT_FAILED' | 'NEEDS_APP_PASSWORD' | 'NEEDS_BRIDGE' | 'NEEDS_OAUTH', hint }` |
| PUT | `/ai-api/mail/accounts/:id` | переименовать, поправить хосты/порты, сменить пароль |
| DELETE | `/ai-api/mail/accounts/:id` | удалить |
| POST | `/ai-api/mail/accounts/:id/test` | повторная проверка соединения, обновляет `status` |
| POST | `/ai-api/mail/accounts/:id/send` | `{ to, subject, text, html?, attachments? }` — отправка (MVP) |
| GET | `/ai-api/mail/accounts/:id/messages?folder=INBOX&limit=50` | фаза 2: список писем |
| GET | `/ai-api/mail/accounts/:id/messages/:uid` | фаза 2: тело письма |

Все действия — в журнал (`lib/journal.ts`): `mail-account-added`, `mail-account-removed`, `mail-sent`, `mail-auth-failed`.
Пароли и тела писем в журнал не попадают.

---

## 5. UI

- Новый экран `mail` («Почта») — добавляется в `ScreenId`, `NAV_DEFAULT_ORDER`, `META` в `sidebar-nav.tsx`, ленивый загрузчик в `screens.tsx`, свой слой стилей `app/styles/screen-mail.css`.
- **Список ящиков**: карточки — имя, адрес, бейдж провайдера, статус SMTP/IMAP (точка ok/warn), «проверить», «удалить». Пустое состояние — «Добавьте первый ящик».
- **Диалог «Добавить ящик»** — три поля. Дальше по шагам с живым прогрессом:
  1. `Ищем настройки для gmail.com…` → показываем найденное (`smtp.gmail.com:465 · imap.gmail.com:993 · источник: встроенный`).
  2. Если у провайдера `authHint ≠ plain` — **сразу**, до ввода пароля, плашка: «Gmail принимает только пароль приложения → как получить».
  3. `Проверяем SMTP…` → `Проверяем IMAP…` → «Готово» / понятная ошибка с кнопкой «Настроить вручную».
  4. «Настроить вручную» раскрывает хосты/порты/шифрование (предзаполнены кандидатом).
- **Отправка письма** (MVP): простая форма — от кого (выбор ящика), кому, тема, текст; вложения — файлы из библиотеки.
- data-testid: `mail-add`, `mail-name`, `mail-email`, `mail-password`, `mail-discover-status`, `mail-account-row-<id>`, `mail-account-test`, `mail-account-delete`, `mail-send-form`, `mail-send-submit`.

---

## 6. Безопасность

- Только TLS: `ssl` (465/993) или `starttls` (587/143) с `requireTLS: true`; `none` допускается только для `127.0.0.1` (Proton Bridge).
- Проверка сертификата включена всегда, кроме loopback.
- Пароль расшифровывается на время одного соединения и не кэшируется.
- Ограничение частоты: discovery — 10/мин на пользователя, попытки авторизации — 5/мин на ящик (после — пауза, запись в журнал).
- Discovery ходит только по `https://` и на порты 25/465/587/143/993; в `guess` не пробуем произвольные порты.
- Ошибки SMTP/IMAP возвращаем пользователю **без** пароля и без сырых ответов сервера.

---

## 7. Порядок работ

**Фаза 1 — MVP (ящики + автопоиск + отправка)**
1. `.env`: `MAIL_SECRET`; `lib/mail-crypto.ts` (AES-GCM).
2. `lib/mail-providers.ts` — таблица провайдеров с `authHint`.
3. `lib/mail-discovery.ts` — цепочка источников, параллельно с таймаутами, нормализация в `{smtp, imap}`.
4. `lib/mail-server.ts` — чтение/запись `accounts.json`, `verifySmtp`, `verifyImap`, `send`.
5. Маршруты из §4 (кроме messages).
6. Экран «Почта»: список, диалог добавления с шагами, форма отправки.
7. Тесты: unit на парсер ISPDB-XML, SRV→конфиг, MX-эвристику, таблицу провайдеров; e2e на диалог (с моком discovery).

**Фаза 2 — чтение почты**: `imapflow`, список папок и писем, просмотр, флаги «прочитано», поиск; писем → в карту памяти как узлы (связь с библиотекой).

**Фаза 3 — OAuth2**: Google и Microsoft (XOAUTH2), тогда Gmail/Outlook без паролей приложений; обновление refresh-токенов на сервере.

**Фаза 4 — ИИ поверх почты**: кратко о непрочитанных, черновики ответов, стикеры из писем.

---

## 8. Что нужно решить до старта

1. **MVP = только отправка** или сразу с чтением (IMAP)? Чтение удлиняет первую итерацию примерно вдвое.
2. Согласны ли на две зависимости (`nodemailer`, `imapflow`) как исключение из правила zero-dependency?
3. Нужны ли Gmail/Outlook «по-настоящему» (OAuth2, фаза 3) сразу, или на старте достаточно паролей приложений + Proton Bridge?
4. Где хранить: серверное шифрование `MAIL_SECRET` (как выше) — или пароли в E2EE-сейфе, но тогда отправка возможна только при разблокированном сейфе в браузере через мост (сложнее, но «zero-knowledge»).
