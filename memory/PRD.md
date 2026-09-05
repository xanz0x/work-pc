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

## Feature: Shared Cloud drive (2026-06)
- Request: cloud storage in Settings, add/remove files, shared with a friend via secret invite link/code, files visually marked vs local. Admin function, no size/type limits.
- Design: built-in shared drive (NOT Google Drive) on Emergent object storage. One global drive.
- Backend: lib/cloud-store.ts (TS storage client init/put/get + shared JSON metadata at AI_DIR/cloud/drive.json), routes under app/ai-api/cloud/* (GET list, join, invite rotate [admin], upload, folder POST/DELETE, file/[id] GET|PATCH|DELETE). Soft-delete (storage has no delete). Access: admin always; others become members by redeeming invite code.
- Frontend: components/cloud-section.tsx (+ cloud-section.css) wired into screen-settings.tsx after SyncSection. Breadcrumb folders, upload (multipart), rename, delete, image preview (inline), "облако · общий" badge to distinguish from local files. Admin sees/rotates invite code + share link.
- Verified end-to-end via curl + friend user: admin sees drive & code, friend GET=member:false, join by code, then sees shared folder & uploads; admin sees friend's file (membersCount:1). Invite code now persisted on first read (was ephemeral bug — fixed).
- Env added: EMERGENT_LLM_KEY, INTEGRATION_PROXY_URL in /app/.env.local.

## SmailPro update (2026-06)
- Removed "Обычная · SmailPro" (temp kind) from UI + POST validation. Renamed Gmail·SmailPro→Gmail, Hotmail/Outlook·SmailPro→Hotmail/Outlook. 3 kinds now: mailtm, gmail, outlook.
- Sonjj credits topped up: Gmail/Outlook create real addresses (verified 201).

## Cloud: design polish + auto-join (2026-06)
- Redesigned components/cloud-section.css to app dark theme (vars from globals.css): accent invite card w/ left gradient bar + glowing code, folder chips (delete on hover), file cards w/ hover lift + "облако · общий" gradient badge, image thumbs. Fixed invisible icons (#set-cloud svg { stroke: currentColor } — app only strokes .btn svg). Added responsive @media(max-width:720px). Added 'cloud' to ALL_SECTIONS + FOCUS_ALIAS so it appears in settings rail and openSetting('cloud') scrolls to it.
- Auto-join via invite link "/?cloud=CODE": app-shell effect redeems code (URL or sessionStorage) then openSetting('cloud') + strips param; login/page.tsx and lib/account.tsx (AccountGate, before /login redirect) stash the code in sessionStorage so it survives the unauthenticated redirect. Verified: visiting the link while logged in auto-joins and opens the cloud section.

## Cloud files -> Library + Map (2026-06)
- Per user: don't show files inside the cloud settings section; shared files appear in Library and Map with a "общий диск" badge.
- Store (lib/store/data.tsx): fetch /ai-api/cloud on mount + on 'wsx:cloud-changed' event; map cloud files to VaultFile (id 'cloud:<id>', shared:true, cloudId, classify() for cluster/icon, tags ['общий диск']). mergedFiles = local + cloud feeds views/fileMap/graph (NOT persisted, NOT in stats/clusterMix/localStorage). VaultFile gained shared?/cloudId? (lib/data.ts).
- FileCardContent: accent "общий диск" chip when file.shared. Library file inspector: insp-cloud block (Скачать + Удалить с диска -> DELETE /ai-api/cloud/file/[id] then dispatch 'wsx:cloud-changed').
- cloud-section.tsx: removed file grid; kept invite/join + upload + folders + hint pointing to Library/Map; dispatches 'wsx:cloud-changed' after upload/join/folder delete.
- Verified: 2 cloud files show in Library with badge + in graph (38 links); settings section shows hint (no grid). Fixed dup import of classify in data.tsx.

## Cloud: map badge + read-only members + fullscreen preview (2026-06)
- Map (screen-map.tsx): Node gained shared flag (from D.fileById(gn.id)?.shared); drawNode draws accent green ring on shared nodes; hover/selected label shows "· общий диск".
- Permissions: cloud-store.ts mutating ops (upload/rename/delete/createFolder/removeFolder) now requireAdmin(); download (readFileBytes) + driveView + joinDrive stay member-level. Verified friend=403, admin=201. cloud-section.tsx hides toolbar/folders for non-admins + read-only hint. Library inspector gates "Удалить с диска" by account.isAdmin (else "только просмотр" note).
- Fullscreen preview: screen-library.tsx cloudPreview state + overlay (components/cloud-viewer.css), img for images / iframe for PDF via /ai-api/cloud/file/[id]?inline=1; "Просмотр" button in inspector for image/pdf. Verified visually.
