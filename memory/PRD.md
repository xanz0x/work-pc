# WorkSpaceX — Temporary Email module

## Текущая задача: визуальный порядок общих панелей (2026-09-05)

### Исходное задание
«У меня есть проект!
Оно у меня по функционалу готово!
Сейчас твоя задача, отнестить к заданию со всем разумом и пониманием!
Мы будем проработывать каждую из страниц до идеала, не нужен лишний текст, или то что неправда, я просто хочу навести визуальный порядок моего проекта!
Давай мы попрробуем что бы ты конкретко понял задание что я требую от тебя!
Наведи визуальный порядок всех мест которые я обозначил!
(Я просто не совсем до конца понимаю что я хочу но я зочу что бы ты меня понял)»

Пользователь приложил скриншот с красными рамками вокруг левого меню, верхней панели и нижней строки состояния. Уточнение подтверждено: **содержимое страницы не трогаем**. Сохранить тёмный стиль и зелёные акценты; выровнять размеры/отступы, убрать визуальный шум; допустима заметная переработка выделенных панелей.

### Архитектура и границы изменений
- Существующий Next.js 16 / React 19 / TypeScript в корне /app. Дизайн «Графит», IBM Plex и существующие SVG сохранены. Новых UI-зависимостей нет.
- Изолированный общий слой `app/styles/shell.css` (`wf053`), подключён из AppShell. Старый CSS-монолит, экранные компоненты и их стили не редактировались.
- Существующие handlers поиска, навигации, загрузки, уведомлений, выхода, настроек и журнала сохранены. Dropdown получил только дополнительные testid.
- Установлены отсутствовавшие зависимости через yarn; обязательная конфигурация входа восстановлена в `.env.local`. Supervisor уже настроен на Next dev:3000. Удалён только служебный Next-индикатор поверх профиля (`devIndicators:false`).
- Актуальные тестовые реквизиты: `memory/test_credentials.md`. Прежние ключи внешних сервисов в текущем окружении отсутствуют; AI/mail/cloud интеграции не реализовывались повторно и не проверялись в этой задаче.

### Реализовано
- Сайдбар: выровненные иконки/счётчики/отступы, спокойное активное состояние, компактные блоки модели/хранилища/профиля без лишних рамок. Неподключённый движок не помечается зелёным как готовый.
- Шапка: поиск и область поиска одинаковой высоты; действия объединены в группу; краткие подписи и реальные счётчики с правильным склонением связей. Семантический пример в placeholder убран, поведение поиска сохранено.
- Строка состояния: убраны фиктивный SESSION 7F3A и безусловная AES-256. Реальные часы, состояние движка и мастер-ключа, краткая ссылка на журнал. Вместо глобального обещания «нет исходящих запросов» указан только режим облачного ИИ.
- Адаптация: иконная колонка на 481–900px, нижнее меню на <=480px; поиск и действия доступны на телефоне; отдельные мобильные кнопки загрузки и выхода. Короткие экраны не перекрывают нижние блоки меню.

### Проверка
- TypeScript PASS, ESLint изменённых компонентов без ошибок (4 существующих предупреждения в hooks/dropdown).
- Testing agent: `test_reports/iteration_41.json`, 23/23 профильных unit-теста. Проверены навигация, настройка меню, сворачивание/перезагрузка, поиск/палитра/области, уведомления/Escape/focus, настройки/админка, logout/login. Панели без горизонтального переполнения на ширинах 320–1920px, масштабах 100–150%.
- Агент отметил один таймаут 20с при 1280x800/150%; его повтор прошёл. Самостоятельные три повторных открытия при 1920x800/150% также прошли; проблема не воспроизведена. Логику запуска/гидратации не меняли без подтверждённой причины.
- Допроверка: реальный TXT принят через существующий file-picker, виден в карточке и инспекторе, удалён штатной кнопкой через клавиатуру; удаление сохранилось после reload. Существующая длинная липкая панель инспектора затрудняет мышиный доступ к нижним действиям — вне согласованной области правок.
- Результат: `test_reports/screenshots_iter41/`, `test_reports/shell_final_verification.json`. Настройка порядка меню, изменённая тестом, возвращена к исходному `ai/nav.json`.

### Приоритеты / следующие задачи
- P0: подтверждённых блокеров изменённых общих панелей нет.
- P1: следующую страницу согласовать с пользователем; рекомендуемый следующий визуальный проход — библиотека/инспектор, включая доступность нижних действий и переполнение кнопок на телефоне. Сейчас намеренно не менялись.
- P1: при повторении задержки запуска собрать browser trace точного 1280x800/150% сценария; не менять auth/splash на основании единственного таймаута.
- P2: последовательная визуальная проверка остальных страниц тем же способом, без выдуманных статусов и лишних текстов.

---
История предыдущих задач (ниже) сохранена; её сведения об окружении могут быть устаревшими.

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

## Features registry + admin toggles for new modules (2026-06)
- lib/users.ts: FeatureId += 'mail' | 'cloud'; FEATURES += Почта/Общее облако; DEFAULT_FEATURES mail:true,cloud:true; DEFAULT_PLANS Basic(mail:true,cloud:false)/Pro(both true). Added normalizeFeatures() to backfill missing keys (default) for old accounts/plans.
- users-server.ts: apply normalizeFeatures in user view(), adminCreateUser, listPlans -> old admin/plans get mail+cloud=true. Admin panel toggles auto-render (admin-plans/admin-plan-editor/admin-user-card map FEATURES). Verified via curl + screenshot.
- Gating: screen-settings SECTION_FEATURE cloud:'cloud' + <CloudSection/> gated by has('cloud'); sidebar-nav 'mail' gated by has('mail').
- Single "общий диск" badge on file card: cloud->VaultFile mapping now tags:[] and desc without the phrase (dir shown as «Папка …»); the accent chip in FileCardContent is the only marker. Verified.

## Admin entry moved to topbar (2026-06)
- Removed 'admin' from sidebar-nav (available filter now excludes it entirely).
- Added shield icon-btn in app-shell topbar (data-testid=topbar-admin-btn), admin-only (account.isAdmin), onClick v.go('admin'); IconShield. Verified via screenshot.
- Admin password set to IceKrymTeam13@ (APP_PASSWORD in /app/.env + /app/.env.local; auto re-synced by seedAdmin).
