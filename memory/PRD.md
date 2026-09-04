# WorkSpaceX — Temporary Email module

## Problem statement (2026-06)
User wants 3 temp-mail options: Standard (SmailPro), Gmail (SmailPro), Outlook/Hotmail (SmailPro).
User has a smailpro.com *web* Premium subscription but no API key, and asked to fetch mailboxes
"from the browser". Provided a SONJJ_API_KEY afterwards.

## Key findings
- smailpro.com web Premium subscription is SEPARATE from the Sonjj API (which the app uses).
- smailpro.com site is behind Cloudflare Turnstile + Google login → browser automation not viable.
- App already supports all 3 SmailPro kinds (temp/gmail/outlook) via Sonjj API (SONJJ_API_KEY) + a
  free mail.tm generator. No code change needed for the 3 options.

## Architecture
- Next.js 16 app at repo root /app (route handlers in app/ai-api/*). No separate backend.
- Package manager: pnpm 10 (via corepack). Preview served by supervisor `frontend` = `next dev` on :3000.
- Env in /app/.env.local: APP_PASSWORD, APP_SESSION_SECRET, MAIL_SECRET, SONJJ_API_KEY, AI_DIR=/app/.data
- Temp mail logic: lib/temp-mail.ts; routes app/ai-api/mail/temp/*.

## Done (2026-06)
- Installed missing node_modules (pnpm install --frozen-lockfile).
- Created /app/.env.local (app password + secrets + user's SONJJ_API_KEY).
- Switched frontend launcher to `next dev`; app boots, login verified, free mail.tm box created.
- Verified 3 SmailPro kinds are wired; SONJJ key is valid but Sonjj account has 0 credits (HTTP 402).

## Blocker / next
- P0 (user action): top up Sonjj credits at my.sonjj.com to enable Gmail/Outlook/Standard SmailPro.
  Once credits exist, all 3 options work with no code change.
