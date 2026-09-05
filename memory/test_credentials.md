# Test Credentials

## App login (WorkSpaceX / Next.js app at /app)
- URL: https://363e5e33-6add-4d48-b1a6-64d4303d394a.preview.emergentagent.com/
- Admin — Login: admin (leave login empty), Password: IceKrymTeam13@  (from APP_PASSWORD; re-synced on startup)
- Friend (test member) — Login: friend, Password: FriendNew2026!  (role user, Basic plan, 30-day license)

## Env files (identical, all keys)
- /app/.env.local (Next.js local, primary) and /app/.env (main copy) — both contain:
  APP_PASSWORD, APP_SESSION_SECRET, MAIL_SECRET, SONJJ_API_KEY, AI_DIR, EMERGENT_LLM_KEY, INTEGRATION_PROXY_URL

## SmailPro / Sonjj API
- SONJJ_API_KEY in env — VALID, credits topped up (Gmail/Outlook working).

## Shared Cloud (Общее облако)
- Object storage via EMERGENT_LLM_KEY + INTEGRATION_PROXY_URL.
- Shared drive metadata: /app/.data/cloud/drive.json. Admins manage; members join via invite code (view/download only).
