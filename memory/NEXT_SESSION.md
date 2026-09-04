# Инструкция для следующего чата — с чего продолжать

Обновлено: 2026-06 · после итерации 33 (почта фаза 1 + новый экран входа).

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
Проверка: `curl -s -o /dev/null -w "%{http_code}" https://mailbox-provisioner.preview.emergentagent.com/login` → 200.

## 1. Что уже сделано (кратко)
- **Почта, фаза 1** — ящики, автопоиск (builtin → ISPDB → autoconfig → SRV → MX → Autodiscover → перебор), живая проверка SMTP (обязательно) + IMAP,
  пароли AES-256-GCM (`MAIL_SECRET`) в `AI_DIR/users/<uid>/mail/accounts.json`, отправка с вложениями с диска.
  Proton: режимы Bridge (сервер пробует 127.0.0.1:1025/1143) и «SMTP-токен · свой домен» (smtp.protonmail.ch:587).
  Файлы: `lib/mail-{providers,discovery,crypto,server,client}.ts`, `app/ai-api/mail/**`, `components/screen-mail.tsx`, `components/mail/*`, `app/styles/screen-mail.css` (@layer wf051).
- **/login** — сцена в стиле экрана замка (`lock-screen login-scene`, @layer wf052 в `app/globals.css`), поля-колодцы с иконками.
- Тесты: `npx vitest run` — 234/234; `tests/api/test_mail.py` (20) + `test_mail_proton_iter32.py` (6); отчёты `test_reports/iteration_31..32.json`.

## 2. С чего продолжать — приоритеты
### P1 · Почта фаза 2: чтение (IMAP)
1. `pnpm add imapflow mailparser` (+ `@types/mailparser`). Единственные новые зависимости, согласованы владельцем.
2. `lib/mail-imap.ts`: `withImap(account, fn)` — подключение по `acc.imap` (учитывать `acc.bridge` → `tls.rejectUnauthorized=false`, порты 1143), пароль через `decryptSecret`, таймауты 15 с, один клиент на запрос (без пула на старте).
3. API: `GET /ai-api/mail/accounts/:id/folders`, `GET …/messages?folder=INBOX&cursor=&limit=30` (ENVELOPE+FLAGS+size, без тел),
   `GET …/messages/:uid?folder=` (тело text/html через mailparser, вложения — список; html санитизировать: без скриптов, картинки через прокси/выкл.),
   `POST …/messages/:uid/flags` (seen/flagged). Все с `withRoute`, лимит 60/мин на ящик (`limitMailRead` в `lib/rate-limit.ts`).
4. UI: в `screen-mail.tsx` третья колонка/вкладка «Входящие»: список папок → список писем (виртуализация не нужна до 30 писем) → просмотр. testid: `mail-folder-*`, `mail-msg-row-*`, `mail-msg-view`.
5. Статус IMAP на карточке становится «живым»: последняя синхронизация, непрочитанные.
6. Письма как узлы карты памяти — отдельная задача после чтения (см. `lib/data.ts`, узлы карты `components/screen-map.tsx`).

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
