# Тестирование аккаунтов и лицензий (Next.js / без БД)

Хранилище: `AI_DIR/users/{users,sessions,licenses,plans}.json`; пароли — scrypt (`scrypt$salt$hash`).
Сессия: cookie `wf_session` (httpOnly, подписана HMAC, sid проверяется по серверному списку) + `wf_uid` (открытый id).

## Модель
- Идентификатор — **логин** (3–32, `[a-z0-9._-]`, без email). Пароль ≥ 8 знаков, при регистрации вводится дважды.
- **Регистрация только по ключу лицензии** `WSX-XXXX-XXXX-XXXX-XXXX`. Ключ выдаёт админ под **тариф** и срок; при
  регистрации аккаунт сразу получает функции, лимит ИИ и срок тарифа. Ключ одноразовый.
- **Тарифы** настраиваются в админке (`/admin` → «Тарифы»): название, описание, цвет, срок по умолчанию, лимит ИИ,
  набор функций. По умолчанию засеваются Basic / Pro / Enterprise.
- Ключ другого тарифа, введённый существующим пользователем, переводит его на новый тариф (срок с текущего момента);
  ключ того же тарифа продлевает срок.
- Админ: логин `admin` (`ADMIN_LOGIN`), пароль `APP_PASSWORD`. Вход одним паролем (без логина) — тоже админ.

## Шаг 1 — состояние на диске
cat /root/.workflow/ai/users/users.json     # login, planId, passHash начинается с "scrypt$"
cat /root/.workflow/ai/users/plans.json     # тарифы
cat /root/.workflow/ai/users/licenses.json  # ключи: только keyHash + маска

## Шаг 2 — API
APP=https://mailbox-provisioner.preview.emergentagent.com
curl -c a.txt -X POST $APP/ai-api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"IceKrymTeam13@"}'
curl -b a.txt $APP/admin/api/plans                                      # тарифы со статистикой (users, freeKeys)
curl -b a.txt -X POST $APP/admin/api/plans -H 'Content-Type: application/json' -d '{"name":"Team","tagline":"…","color":"blue","days":60,"aiDailyLimit":20,"features":{"ai":true,"mcp":false,"sync":true,"secrets":true,"offline":true,"telemetry":true}}'
curl -b a.txt -X PATCH $APP/admin/api/plans/<id> -d '{"days":90,"archived":true}'   # правка / архив
curl -b a.txt -X DELETE $APP/admin/api/plans/<id>                                   # только без пользователей и ключей
curl -b a.txt -X POST $APP/admin/api/licenses -H 'Content-Type: application/json' -d '{"planId":"<planId>","days":30,"note":"кому","count":3}'   # keys[] показываются один раз
curl -X POST $APP/ai-api/auth/key -H 'Content-Type: application/json' -d '{"key":"WSX-…"}'          # предпросмотр: тариф + дни (без активации)
curl -c u.txt -X POST $APP/ai-api/auth/register -H 'Content-Type: application/json' -d '{"login":"ivan","password":"password-123","passwordConfirm":"password-123","key":"WSX-…"}'
curl -b u.txt $APP/ai-api/auth/session                                  # access:"ok", user.plan = {id,name,color}
curl -b u.txt -X POST $APP/ai-api/auth/license -d '{"key":"WSX-…"}'      # продление / смена тарифа
curl -b a.txt -X POST $APP/admin/api/users/<uid> -d '{"action":"set-plan","planId":"<id>"}'         # перевод на тариф
curl -b a.txt -X POST $APP/admin/api/users/<uid> -d '{"action":"grant-license","days":30}'          # продлить
curl -b a.txt -X POST $APP/admin/api/users/<uid> -d '{"action":"revoke-license"}'                   # снять

Коды ошибок ключа: `INVALID`, `USED`, `REVOKED`, `PLAN_GONE`; регистрация: `LOGIN_TAKEN` (409), `INVALID_ARGS` (400).
Лимиты: вход — 10 попыток / 15 мин с IP; ключи (`/auth/key`, `/auth/register`, `/auth/license`) — 30 / 15 мин.

## Шаг 3 — автотесты
npx vitest run tests/unit/users.test.ts
APP_URL=$APP python3 -m pytest tests/api/test_admin.py -q
PLAYWRIGHT_BROWSERS_PATH=/pw-browsers APP_URL=$APP APP_PASSWORD=IceKrymTeam13@ npx playwright test tests/e2e/23-admin-accounts.spec.ts
