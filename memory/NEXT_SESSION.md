# Инструкция для следующего чата — с чего продолжать

Обновлено: 2026-06 · итерация 36 — рефакторинг почты (пул IMAP + кэш папок + компактный UI) ЗАВЕРШЁН и протестирован.

## Состояние
- Рефакторинг из прошлой сессии закоммичен (`763567a`) и доведён до зелёного:
  `Pooled.folders` превращён в реальный кэш LIST на 8 с (сброс при смене флага seen), мёртвый `openFolder` удалён.
  Замеры: `folders` 5.7 с (холодный логин) → 0.10–0.23 с из кэша → ~2.3 с после TTL (без логина); `messages` ~0.37–0.55 с;
  письмо из префетча — 0.06 с; переключение папок из кэша 0.04 с.
- Итерация 35 нашла 4 дефекта синхронизации локальных кэшей в `components/mail/mail-inbox.tsx` — все исправлены
  (`patchRows` пишет в `pages.current`; `loadPage` сверяет кэш писем со свежими строками; `flag()` патчит только
  изменённые ключи и берёт «до» из открытого письма; `bumpUnseen` правит `imapSync` ящика; `open()` доверяет строке списка).
  Итерация 36 — ретест 5/5 PASS, регресс чистый. Вёрстка шапки списка: `nowrap` для счётчика/времени.
- Регресс: `npx vitest run` 247/247, `pytest tests/api/test_mail_read.py` 14/14 (сразу после restart frontend
  первый прогон может упасть — дать ~20 с на прогрев; тест лимита съедает 60 запросов/мин, скриншоты делать через минуту).
- Среда после сброса пода восстановлена: `pnpm install`, `/app/.env` (значения — `memory/test_credentials.md`), прод-сборка.

## Временная почта (итерация 37) — что готово и что нужно от владельца
- Бесплатный генератор **mail.tm** работает без ключа (домен @uberip.com): создать, читать входящие, удалить.
- **SmailPro** (обычная временная 10 мин с продлением, временный Gmail, временный Hotmail/Outlook) реализован по
  Sonjj API (`https://app.sonjj.com`, заголовок `X-Api-Key`). Нужен `SONJJ_API_KEY` в `/app/.env` (my.sonjj.com → API,
  оплата кредитами Sonjj; веб-подписка Premium на smailpro.com ключа НЕ даёт). Без ключа маршруты отдают 503 `NO_KEY`.
- Просьба пользователя «зайти в мой аккаунт smailpro.com браузером и брать почту оттуда» НЕ реализована:
  потребуется серверный Chromium (Playwright) + хранение его логина/пароля + обход Cloudflare/CAPTCHA; хрупко и против ToS.
  Если возвращаться к этому — обсудить риски и отдельный «браузерный режим» с ручным входом.
- Файлы: `lib/temp-mail.ts`, `lib/temp-mail-route.ts`, `app/ai-api/mail/temp/**`, `components/mail/mail-temp-{rail,pane}.tsx`.
- Тесты: `tests/api/test_mail_temp.py` (15), отчёт `test_reports/iteration_37.json`. НЕ проверена реальная доставка письма
  во временный ящик (нет исходящего SMTP в поде).

### Бэклог (по приоритету)
- P1 · копия отправленного письма не попадает в папку «Отправленные» (нужен IMAP APPEND в `lib/mail-server.ts`).
- P1 · правка ящика: кнопка «Изменить» в `mail-account-panel.tsx` → `MailAddDialog` в режиме edit (серверный PUT готов).
- P1 · письма как узлы карты памяти · скачивание вложений (`c.download(uid, part)`) · inline-картинки (cid) · поиск по папке (IMAP SEARCH) · «Ответить» с цитированием.
- P2 · общий бюджет времени discovery · кнопка-глаз для паролей · живой индикатор Proton Bridge · тумблер функции `mail` в админке
  · data-testid для фактов паспорта ящика (`mail-account-fact-*`) · вынести три ref-кэша `mail-inbox.tsx` в хук `useMailCache`.
- P3 · OAuth2 (XOAUTH2) Google/Microsoft — нужны Client ID/Secret, перед кодом вызвать `integration_expert`.
- P4 · ИИ поверх почты (сводки, черновики), отправка по расписанию/от агента (MCP `mail.send`).

---

## (справка) Итерация 34 — почта фаза 2, чтение по IMAP.

## 0. Первые 5 минут: восстановить среду (под мог сброситься)
Признаки сброса: нет `/app/node_modules`, нет `/app/.env`, `sudo supervisorctl status frontend` → ERROR.

```bash
cd /app && npm i -g pnpm@10 && pnpm install --frozen-lockfile
# .env (значения — в memory/test_credentials.md; секреты генерировать: openssl rand -hex 32)
#   APP_PASSWORD, APP_SESSION_SECRET, APP_SESSION_TTL_HOURS=12, ADMIN_LOGIN=admin,
#   AI_PROXY_URL=https://integrations.emergentagent.com/llm, EMERGENT_LLM_KEY (emergent_integrations_manager),
#   AI_MODEL=claude-sonnet-4-5-20250929, NEXT_PUBLIC_AI_MODEL_LABEL, AI_DIR=/root/.workflow/ai, MAIL_SECRET (32+ hex)
npx next build && sudo supervisorctl restart frontend      # прод-сборка, ~2 мин; dev-режим НЕ использовать
```
Проверка: `curl -s -o /dev/null -w "%{http_code}" https://layout-perfect-4.preview.emergentagent.com/login` → 200.

## 1. Что уже сделано (кратко)
- **Почта, фаза 1** — ящики, автопоиск (builtin → ISPDB → autoconfig → SRV → MX → Autodiscover → перебор), живая проверка SMTP (обязательно) + IMAP,
  пароли AES-256-GCM (`MAIL_SECRET`) в `AI_DIR/users/<uid>/mail/accounts.json`, отправка с вложениями с диска.
  Proton: режимы Bridge (сервер пробует 127.0.0.1:1025/1143) и «SMTP-токен · свой домен» (smtp.protonmail.ch:587).
  Файлы: `lib/mail-{providers,discovery,crypto,server,client}.ts`, `app/ai-api/mail/**`, `components/screen-mail.tsx`, `components/mail/*`, `app/styles/screen-mail.css` (@layer wf051).
- **/login** — сцена в стиле экрана замка (`lock-screen login-scene`, @layer wf052 в `app/globals.css`), поля-колодцы с иконками.
- **Почта, фаза 2 (чтение)** — см. §2 ниже: imapflow/mailparser, 4 маршрута чтения, панель «Входящие».
- Тесты: `npx vitest run` — 247/247; `tests/api/test_mail.py` (20) + `test_mail_proton_iter32.py` (6) + `test_mail_read.py` (14); отчёты `test_reports/iteration_31..34.json`.

## 2. С чего продолжать — приоритеты
### P1 · Почта фаза 2 — чтение: СДЕЛАНО (итерация 34)
Что есть: `lib/mail-imap.ts` (imapflow, один клиент на запрос, повтор при CONNECT_FAILED), `lib/mail-html.ts` (санитайзер),
`lib/mail-read.ts` (страницы/порядок папок), `lib/mail-read-route.ts` (guard: 503 MAIL_DISABLED / 404 / 429 60-в-мин),
API `GET …/folders`, `GET …/messages?folder&cursor&limit[&withFolders=1]`, `GET …/messages/:uid?folder[&markSeen=0]`,
`POST …/messages/:uid/flags {folder,seen?,flagged?}`; UI `components/mail/mail-inbox.tsx` (+ folder-list / msg-list / msg-view),
панель `mail-inbox` под сеткой экрана «Почта» для активного ящика; тело письма — iframe sandbox + CSP, картинки по кнопке.
Автообновление: select `mail-inbox-refresh-interval` (0/30/60/300, localStorage `wf.mail.refresh.v1`), кнопка `mail-inbox-refresh`.
Тесты: `tests/unit/mail-read.test.ts` (13), `tests/api/test_mail_read.py` (14), отчёт `test_reports/iteration_34.json`.
Ошибки IMAP отдаются как 503 (не 502: прокси превью подменяет 502 своей страницей) — то же сделано в send.
Осталось из фазы 2 (P1, по порядку): письма как узлы карты памяти (`lib/data.ts`, `components/screen-map.tsx`);
скачивание вложений (`c.download(uid, part)` — сейчас только список); cid-картинки (inline) в письме; поиск по папке (IMAP SEARCH).

### P1 · Правка ящика из карточки
Кнопка «Изменить» в `mail-account-card.tsx` → тот же `MailAddDialog` в режиме edit (prefill name/user/hosts, пароль пустой = не менять) → `mailApi.update`. Серверный `PUT` уже готов: при неработающем пароле/хостах возвращает 422 и ничего не сохраняет.

### P2 · Мелочи почты
- Общий бюджет времени discovery (сейчас per-source таймауты, худший случай ~15 с).
- Кнопка-глаз «показать пароль» в диалоге ящика и на /login; индикатор силы пароля при регистрации.
- Живой индикатор Bridge на карточке Proton-ящика (перепроба 127.0.0.1:1025 при открытии экрана).
- Тумблер функции `mail` в админке (см. `FeatureId` в `lib/users.ts`) — сейчас экран доступен всем.

### P2 · Фаза 3: OAuth2 (XOAUTH2) Google/Microsoft — снимет пароли приложений, откроет Outlook. Нужны Client ID/Secret от владельца → перед кодом вызвать integration_expert.
### P3 · Фаза 4: ИИ поверх почты (сводки, черновики ответов), отправка по расписанию/от агента (MCP-инструмент `mail.send`).

## 3. Правила, о которых легко забыть
- Изменения в коде видны только после `npx next build && sudo supervisorctl restart frontend` (нет hot-reload прод-сборки).
- CSS экранов — свои файлы `app/styles/screen-*.css` со своим `@layer wfNNN` (следующий свободный — **wf053**; объявить в списке `@layer …;` в начале `globals.css`).
  Новые экраны добавлять в `tests/unit/css-split.test.ts` (список файлов) и `scripts/split-css.py`.
- Общие классы (`.spin`, `.rot90`) в экранных CSS не объявлять — префиксовать (`mail-spin`).
- Новый экран = правки в `lib/store/nav.tsx` (ScreenId), `lib/nav-prefs.ts`, `components/sidebar-nav.tsx`, `components/app-shell.tsx` (3 места), `components/screens.tsx`, `lib/commands.ts` (+ `CommandIcon` и `components/command-palette.tsx`), `tests/unit/commands.test.ts` (счётчик nav-команд).
- Журнал безопасности — клиентский IndexedDB (`logJournal` из `lib/journal.ts`); новые kinds добавлять в `JOURNAL_KINDS` и в `JKIND_ICON` (`screen-activity.tsx`).
- Пароли ящиков не логировать и не возвращать; в ответах API только `hasPassword: true`.
- Тест-агент: онбординг обходить через localStorage `wf.settings.v1` → `{onboarding:{at:…}}` + reload; логин-форму заполнять после `networkidle`.

## 4. Тестовые данные
- admin / IceKrymTeam13@ (см. `memory/test_credentials.md`).
- Ethereal (фейковый SMTP/IMAP, письма видны на https://ethereal.email): `dzzbuk33bcyzyoqm@ethereal.email / 22FNUDY5JhDHu75uaE`,
  `qtf2kannuu6gjlxb@ethereal.email / 2T6upz7zfYqNGbAGRs`. Новый: `node -e "require('nodemailer').createTestAccount().then(a=>console.log(a.user,a.pass))"`.
  Ethereal поддерживает IMAP (imap.ethereal.email:993) — подходит для тестов фазы 2.
