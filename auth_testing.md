# Тестирование аккаунтов (адаптация плейбука под Next.js / без БД)

Хранилище: `AI_DIR/users/{users,sessions,licenses}.json`; пароли — scrypt (`scrypt$salt$hash`).
Сессия: cookie `wf_session` (httpOnly, подписана HMAC, sid проверяется по серверному списку) + `wf_uid` (открытый id).

## Шаг 1 — состояние на диске
cat /root/.workflow/ai/users/users.json     # passHash начинается с "scrypt$", есть role/status/features
cat /root/.workflow/ai/users/sessions.json  # живые сессии (sid, uid, expiresAt)
ls /root/.workflow/ai/users/<uid>/           # личный каталог пользователя (sessions/, mcp-access/, sync/)

## Шаг 2 — API
APP=https://token-permissions.preview.emergentagent.com
curl -c c.txt -X POST $APP/ai-api/auth/login -H 'Content-Type: application/json' -d '{"password":"IceKrymTeam13@"}'   # админ одним паролем
curl -b c.txt $APP/ai-api/auth/session                     # {authed:true, user:{role:"admin"}, access:"ok"}
curl -b c.txt $APP/admin/api/overview
curl -X POST $APP/ai-api/auth/register -H 'Content-Type: application/json' -d '{"email":"u@x.io","password":"password-123","name":"U"}'
# новый пользователь: access = "license"; /ai-api/sessions → 403 LICENSE_REQUIRED
curl -b c.txt -X POST $APP/admin/api/licenses -H 'Content-Type: application/json' -d '{"days":30,"note":"test"}'   # key показывается один раз
curl -b u.txt -X POST $APP/ai-api/auth/license -H 'Content-Type: application/json' -d '{"key":"WSX-...."}'

## Шаг 3 — автотесты
APP_URL=$APP python3 -m pytest tests/api/test_admin.py -q
PLAYWRIGHT_BROWSERS_PATH=/pw-browsers APP_URL=$APP APP_PASSWORD=IceKrymTeam13@ npx playwright test tests/e2e/23-admin-accounts.spec.ts
