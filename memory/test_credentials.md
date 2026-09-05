# Test Credentials

## App login (WorkSpaceX / Next.js app at /app)
- URL: https://af64b12e-8048-4269-9ee1-77ebc46f6cec.preview.emergentagent.com/
- Admin — Login: admin (leave login empty), Password: IceKrymTeam13@  (from APP_PASSWORD; re-synced on startup)
- Friend (test member) — Login: friend, Password: FriendNew2026!  (role user, Basic plan, 30-day license)

## Текущее окружение после восстановления (визуальные правки каркаса)
- /app/.env.local: APP_PASSWORD (прежний пароль admin), новый APP_SESSION_SECRET, APP_SESSION_TTL_HOURS=12, ADMIN_LOGIN=admin, AI_DIR=/app/ai, APP_URL.
- /app/frontend/.env: REACT_APP_BACKEND_URL — текущий адрес превью выше.
- Ключи сторонних сервисов из прошлой сессии отсутствуют. Внешние интеграции в этой задаче не менялись и не проверяются. Не использовать старые заявления ниже как подтверждение их текущей доступности.
- Учётная запись friend не проверена; для тестов каркаса использовать admin.

## SmailPro / Sonjj API
- SONJJ_API_KEY in env — VALID, credits topped up (Gmail/Outlook working).

## Shared Cloud (Общее облако)
- Object storage via EMERGENT_LLM_KEY + INTEGRATION_PROXY_URL.
- Shared drive metadata: /app/.data/cloud/drive.json. Admins manage; members join via invite code (view/download only).
