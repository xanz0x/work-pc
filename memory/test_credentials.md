# Тестовые доступы · WorkSpaceX

## Вход в приложение (P0-2, волна 1)
- Страница входа: `/login`
- Пароль приложения: `IceKrymTeam13@`
- Переменная окружения: `APP_PASSWORD` в `/app/.env`
- `/app/.env` восстановлен 2026-09-03 (файл пропадает вместе с pod'ом): помимо
  `APP_PASSWORD` в нём `APP_SESSION_SECRET` (локальный dev-ключ подписи cookie,
  меняется свободно — старые сессии просто перестанут проходить) и
  `APP_SESSION_TTL_HOURS=12`. Без этих переменных прод-сервер не поднимается
- Cookie сессии: `wf_session` (httpOnly, 12 часов), выдаётся `POST /ai-api/auth/login`
- Проверка сессии: `GET /ai-api/auth/session`, выход: `DELETE /ai-api/auth/session`
- Без cookie любой маршрут `/ai-api/*` отвечает 401 `{"code":"AUTH_REQUIRED"}`,
  кроме `POST /ai-api/auth/login` и `POST /ai-api/telemetry` (приём клиентской
  ошибки открыт, чтобы падение на экране входа доходило до трекера)

## Лимиты
- `/ai-api/chat`: 10 ходов в минуту и 200 в сутки с одного IP → 429 `{"code":"RATE_LIMITED"}`.
  Битые тела (400) бюджет не тратят — считается только разобранный запрос
- `/ai-api/auth/login`: 10 попыток на 15 минут с IP → 429
- `POST /ai-api/telemetry`: 30 записей на 5 минут с IP → 429
- В тестах лимит обходится своим адресом: заголовок `X-Forwarded-For`

## Мастер-ключ сейфа
Замок пользовательский: если он включён в браузере, пароль знает только владелец.
В чистом профиле замок выключен, никакого мастер-ключа вводить не нужно.

E2E-сценарии (`tests/e2e/`) создают замок в чистом профиле браузера с паролем
`e2e-master-2026`. К данным разработчика он отношения не имеет: профиль Playwright
одноразовый.

## Первый запуск (NF-4)
- Новый профиль браузера начинает с онбординга из трёх шагов; он перекрывает
  интерфейс, пока не пройден.
- В e2e он гасится хелпером `skipOnboarding(page)` (`tests/e2e/onboard.ts`):
  в `localStorage` пишется `wf.settings.v1.onboarding.at`.
- Сценарий `tests/e2e/11-onboarding.spec.ts` проходит шаги честно и создаёт PIN
  `123456` в одноразовом профиле Playwright.

## Модель
- Облачная модель: `claude-sonnet-4-5-20250929` (`AI_MODEL`), подпись в UI — `NEXT_PUBLIC_AI_MODEL_LABEL`
- Шлюз: `AI_PROXY_URL=https://integrations.emergentagent.com/llm`
  (OpenAI-совместимый, вызывается `${AI_PROXY_URL}/chat/completions`)
- Ключ шлюза: `EMERGENT_LLM_KEY` в `/app/.env` (универсальный ключ Emergent)
- Движок в интерфейсе выбирается в «Настройках» и вступает в силу только после
  кнопки «Сохранить» (`data-testid="settings-save"`)

## Конфигурация (AR-5, волна 2)
- Полный список переменных с комментариями: `/app/.env.example`
- Сервер не стартует при неполной конфигурации: `instrumentation.ts` → `lib/env.ts`
- `/app/.env` и `/app/.env.example` не хранятся в git (оба под `.gitignore`):
  после сброса пода восстанавливать по этому файлу. Обязательны `APP_PASSWORD`
  и `APP_SESSION_SECRET` (32+ символа, например `openssl rand -hex 32`).
  Смена секрета инвалидирует прежние cookie — это ожидаемо
- Метрики и последние ошибки: `GET /ai-api/telemetry` (нужна cookie сессии).
  Живут в памяти процесса: перезапуск фронтенда обнуляет их, поле `since`
  показывает начало отсчёта
- `AI_DIR=/root/.workflow/ai` засевается при старте из репозитория (`ai/`):
  существующие файлы не перезаписываются

## Как прогнать всё локально
```bash
cd /app
npx tsc --noEmit
npx eslint .
npx vitest run
python3 -m pytest tests/api -q
PLAYWRIGHT_BROWSERS_PATH=/pw-browsers APP_URL=http://localhost:3000 \
  APP_PASSWORD=IceKrymTeam13@ npx playwright test
APP_URL=http://localhost:3000 APP_PASSWORD=IceKrymTeam13@ node scripts/long-dialog.mjs
```
Новые сценарии e2e (сессия 3): `09-file-key.spec.ts` (файловый ключ, пароль
файла `e2e-file-pass-2026`), `10-first-frame-write.spec.ts` (архив из 20 файлов),
второй тест в `06-storage-migration.spec.ts` (вход через `/login`).
Хелпер чтения IndexedDB из тестов — `tests/e2e/idb.ts`.

Браузеры Playwright после сброса пода ставятся заново:
`PLAYWRIGHT_BROWSERS_PATH=/pw-browsers npx playwright install chromium`.
Зависимости — pnpm: `npx -y pnpm@10.11.0 install --frozen-lockfile`.

## Волна 4 · NF-7 / NF-8 (2026-09-03)
- Пароль снимка бэкапа в e2e (`16-backup-flags.spec.ts`): `снимок-пароль-2026`.
  Это пароль ОТДЕЛЬНЫЙ от мастер-ключа: снимок открывается только им.
- Флаги и автономный режим живут в `localStorage` под ключом `wf.flags.v1`.
- Node в поде: pnpm 11 требует Node ≥ 22.13, стоял Node 20. Поставлен Node 22
  (arm64) в `/usr/local`, после чего `pnpm install` проходит; сборочные скрипты
  включаются вручную: `pnpm rebuild esbuild unrs-resolver @tailwindcss/oxide`.
- Supervisor запускает ПРОДАКШН-сервер (`next start`), поэтому после правок
  нужен `npx next build && sudo supervisorctl restart frontend`.
- Из-за прод-сборки cookie входа помечена `Secure`, и `pytest tests/api` по
  `http://localhost:3000` получает 401 на всё после входа. Прогонять их надо по
  https-адресу preview: `APP_URL=https://compose-speedup.preview.emergentagent.com
  python3 -m pytest tests/api -q`. Оставшиеся падения там — среда, а не код:
  нет `/root/.workflow/ai/*` (файлы скиллов лежат в `/app/ai`) и не запущен
  локальный Ollama (503).

## Восстановление пода (2026-06, итерация 23)
- `/app/.env` снова пропал вместе с подом — восстановлен по списку выше
  (`APP_PASSWORD=IceKrymTeam13@`, новый `APP_SESSION_SECRET`, TTL 12 ч,
  `AI_PROXY_URL` + `EMERGENT_LLM_KEY`, `AI_MODEL=claude-sonnet-4-5-20250929`).
- Зависимости: `npm i -g pnpm@10 yarn && pnpm install --frozen-lockfile`
  (pnpm 11 требует Node ≥22.13, в поде Node 20 → ставить pnpm 10).
- После правок обязательно `npx next build && sudo supervisorctl restart frontend`.
- Новые data-testid: `lock-cell-0..5` (экран блокировки),
  `settings-clear-index`, `settings-delete-vault`,
  `settings-delete-vault-confirm`, `settings-delete-vault-cancel`.

## Итерация 24 (2026-06)
- Продукт переименован в **WorkSpaceX**; пароль входа не менялся: `IceKrymTeam13@`.
- Масштаб интерфейса живёт в `localStorage['wf.ui.scale']` (80–150). Сбросить:
  `localStorage.removeItem('wf.ui.scale')` или кнопка `ui-scale-reset`.
- Новые data-testid: `ui-scale-slider`, `ui-scale-minus`, `ui-scale-plus`,
  `ui-scale-value`, `ui-scale-reset`, `ui-scale-preset-{80,100,125,150}`,
  `app-splash` (сплэш холодного старта, уходит ≤3 с).

## NF-10 · MCP наружу (2026-06-04)
- Эндпоинт агента: `POST {APP_URL}/mcp`, заголовок `Authorization: Bearer wsx_<id>_<secret>`.
  Токен выдаётся в Настройки → «MCP наружу» (`mcp-token-issue`) и показывается один раз;
  на сервере хранится только хеш (`/root/.workflow/ai/mcp-access/tokens.json`).
- Управление: `GET/POST/DELETE /mcp/admin/tokens`, `GET /mcp/admin/pending`,
  `GET/POST /mcp/admin/bridge` — нужна cookie сессии `wf_session`.
- Инструменты работают только при открытой вкладке приложения (иначе `NO_BRIDGE`);
  `create_secret` требует одобрения в UI и разблокированного сейфа.
- Тесты: `APP_URL=https://compose-speedup.preview.emergentagent.com python3 -m pytest tests/api/test_mcp.py -q`;
  e2e `tests/e2e/21-mcp-external.spec.ts` создаёт PIN `123456` в одноразовом профиле.
- `.env` восстановлен 2026-06-04 (пароль прежний `IceKrymTeam13@`), добавлен `/app/.env.example`.

## NF-11 · Синхронизация (2026-06-04)
- Раздел Настройки → «Синхронизация» (`settings-sync`): `sync-create` создаёт пространство и
  показывает 12 слов (`sync-words`); `sync-join-phrase` + `sync-join` присоединяет второе устройство.
- Фраза — единственный ключ: сервер её не хранит. В e2e (`22-sync-e2ee.spec.ts`) она генерируется
  на лету в одноразовых контекстах браузера.
- Серверные данные: `/root/.workflow/ai/sync/<spaceId>/` — только шифртекст.
- Тесты: `APP_URL=https://compose-speedup.preview.emergentagent.com python3 -m pytest tests/api/test_sync.py -q`.

## Аккаунты, тарифы и ключи лицензий (2026-06, итерация 28)
- **Администратор**: логин `admin` (`ADMIN_LOGIN` в `/app/.env`), пароль `IceKrymTeam13@` (= `APP_PASSWORD`). Вход одним паролем без логина — тоже админ (совместимость). Email больше НЕ используется.
- Вход: `POST /ai-api/auth/login {login, password}`. Регистрация ТОЛЬКО по ключу лицензии: `POST /ai-api/auth/register {login, password, passwordConfirm, key}`. Логин 3–32 символа `[a-z0-9._-]`, пароль ≥ 8.
- Предпросмотр ключа без активации: `POST /ai-api/auth/key {key}` → тариф + дни. Активация/продление вошедшим: `POST /ai-api/auth/license {key}`.
- **Тарифы** (`/admin` → вкладка «Тарифы», API `/admin/api/plans`, `/admin/api/plans/[id]`): по умолчанию Basic (30 дн, 50 ИИ/сутки, без MCP и синка), Pro (90 дн, 300, всё), Enterprise (365 дн, ∞, всё). Тариф задаёт функции + лимит; ключ = тариф + срок.
- **Ключи** (`/admin` → «Ключи», `POST /admin/api/licenses {planId, days, note, count≤25}`) — показываются один раз, на диске только sha256-хеш.
- Карточка пользователя: `POST /admin/api/users/[id] {action:'set-plan', planId}` / `grant-license` / `revoke-license`.
- Файлы: `/root/.workflow/ai/users/{users,sessions,licenses,plans}.json`. Старые записи с `email` мигрируются в `login` (часть до @) при первом запуске.
- Лимиты: вход 10 неудачных / 15 мин с IP; ключи — 30 НЕУДАЧНЫХ попыток / 15 мин (удачные не тратят бюджет).
- Тесты: `npx vitest run tests/unit/users.test.ts`; `APP_URL=https://compose-speedup.preview.emergentagent.com python3 -m pytest tests/api/test_admin.py tests/api/test_plans_licensing.py -q`; e2e `tests/e2e/23-admin-accounts.spec.ts`. Подробно — `/app/auth_testing.md`.
- Тестовые пользователи создаются на лету (qa-*, tester1, demo_user с паролем `password-123`, тариф Pro) — можно удалять из админки.

## Модуль «Почта» (2026-06, фаза 1)
- Экран «Почта» в меню (`nav-mail`), API `/ai-api/mail/*` под сессией. Требует `MAIL_SECRET` (32+ символов) в `/app/.env` — задан.
- Тестовые ящики Ethereal (fake SMTP/IMAP, письма не доставляются, видны на https://ethereal.email):
  - `qtf2kannuu6gjlxb@ethereal.email` / `2T6upz7zfYqNGbAGRs`
  - `dzzbuk33bcyzyoqm@ethereal.email` / `22FNUDY5JhDHu75uaE`
  - Автопоиск находит их через DNS SRV: smtp.ethereal.email:587 STARTTLS, imap.ethereal.email:993 SSL.
  - Новый: `node -e "require('nodemailer').createTestAccount().then(a=>console.log(a.user,a.pass))"`
- Gmail с любым паролем → `NEEDS_APP_PASSWORD` (реальный SMTP-ответ). Ящики: `/root/.workflow/ai/mail/accounts.json` (пароль AES-GCM).
- Лимиты: discover 10/мин на пользователя, попытки авторизации 5/мин на ящик (429 RATE_LIMITED).

## Почта, фаза 2 — чтение (2026-06, итерация 34)
- У admin добавлен ящик Ethereal `a2fa8b81` (qtf2kannuu6gjlxb@ethereal.email) — его переиспользует `tests/api/test_mail_read.py`, не удалять.
- Чтение: `GET /ai-api/mail/accounts/:id/folders|messages|messages/:uid`, `POST …/messages/:uid/flags`; лимит 60/мин на ящик → 429.
- Письма во «Входящие» Ethereal попадают только self-send через `POST …/send` (доставка 2–10 с).
- Прогон: `APP_URL=https://compose-speedup.preview.emergentagent.com python3 -m pytest tests/api/test_mail_read.py -q` (тест лимита — последний, съедает бюджет минуты).
- UI testid: `mail-inbox`, `mail-folder-<path>`, `mail-folder-unseen-<path>`, `mail-msg-row-<uid>` (`data-unread`), `mail-msg-open-<uid>`, `mail-msg-star-<uid>`,
  `mail-msg-view`, `mail-msg-view-seen/-star/-images/-frame/-attachments`, `mail-inbox-refresh`, `mail-inbox-refresh-interval`, `mail-inbox-synced`, `mail-account-unseen`.

## Обновлено 2026-06 (итерация 36) · после сброса пода
- `/app/.env` пересоздан: APP_PASSWORD=IceKrymTeam13@, новые APP_SESSION_SECRET и MAIL_SECRET (старые cookie и ранее сохранённые пароли ящиков после смены MAIL_SECRET требуют повторного ввода), ADMIN_LOGIN=admin, AI_PROXY_URL, EMERGENT_LLM_KEY, AI_MODEL=claude-sonnet-4-5-20250929, AI_DIR=/root/.workflow/ai.
- Вход: admin / IceKrymTeam13@ (поля формы: login, password).
- Тестовый ящик почты: Read QA · qtf2kannuu6gjlxb@ethereal.email / 2T6upz7zfYqNGbAGRs (IMAP imap.ethereal.email:993, SMTP smtp.ethereal.email:587). Папки: INBOX, Drafts, "Sent Mail", Junk (Спам), Trash.

## Временная почта (итерация 37)
- Ключ SmailPro/Sonjj: `SONJJ_API_KEY` в `/app/.env` (получить в https://my.sonjj.com → раздел API, оплата кредитами). Сейчас НЕ задан: генераторы Gmail/Outlook/SmailPro отвечают 503 NO_KEY, бесплатный mail.tm работает без ключа.
- Тесты: `python3 -m pytest tests/api/test_mail_temp.py -q`; тест лимита включается `RUN_TEMP_RATE_LIMIT=1` и только последним.

## Доставка письма во временный ящик (для регрессов, итерация 38)
- MX домена uberip.com = `in.mail.tm`, порт 25 из пода открыт, приём без авторизации: письмо можно отправить python smtplib напрямую.
- Готовый тест: `python3 -m pytest tests/api/test_mail_temp_delivery.py -q` (письмо доходит за ~5 с). formsubmit.co НЕ доставляет.
