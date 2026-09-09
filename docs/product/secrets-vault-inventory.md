Инвентаризация завершена — все ключевые файлы прочитаны, приёмка проверена. Итоговый отчёт:

---

# Инвентаризация vault-core-arch (WorkSpaceX · local ai vault)

**Стек:** Next.js 16.3.3 / React 19 / TS strict / Tailwind v4 / pnpm. Одиночная страница (`app/page.tsx`), всё состояние в React Context. Ни одного бэкенда — только браузерные API.

## 1. Структура проекта и навигация

**Экраны (ScreenId):** `lib/vault-store.tsx:78` — `type ScreenId = 'library' | 'map' | 'chat' | 'settings'`. Навигация — не роутер, а поле `screen` в едином сейфе.
- `app/page.tsx` — условный рендер четырёх экранов внутри `<AppShell>`.
- `components/app-shell.tsx:38-46` — массивы `WORKSPACE` (library/map/chat) и `SYSTEM` (settings) с иконками из `components/icons.tsx`; кнопки `nav-item` зовут `v.go(id)`.
- **Точки, обязательные при добавлении нового ScreenId** (TS strict не даст забыть): `ScreenId` (vault-store:78), `PLACEHOLDER: Record<ScreenId,string>` (app-shell:49), `workspaceCount: Record<ScreenId,number>` (app-shell:132), `statusText` (app-shell:147), `page.tsx:20-23`.
- Каркас: сайдбар 248px (`brand`, `nav-add`, `nav`, кластеры, `sidebar-foot`: engine-pill, storage-bar, profile) → топбар 56px (поиск, scope-дропдаун, статус-чип, колокольчик, кнопка-замок, шестерёнка) → контент → `statusbar` 28px. Состояние свёрнутости сайдбара — `localStorage['wf-nav']`.
- Крупнейшие компоненты: `screen-library.tsx` (2008 строк), `screen-map.tsx` (1605, canvas), `lib/vault-store.tsx` (1462), `screen-settings.tsx` (638), `screen-chat.tsx` (606).
- Вспомогательное: `components/dropdown.tsx` (дропдауны/чипы), `notifications.tsx` (колокольчик + лента), `command-palette.tsx` (Ctrl+K), `chat/` (composer, messages, retrieval-trace, source-desk, session-rail), `ui/` (beam, num-ticker — ручные порты Magic UI).

## 2. Система замка (критично для встраивания)

**Уровень A — мастер-ключ:** PIN ровно 6 цифр ИЛИ пароль ≥8 симв. (`validateSecret` в `lib/lock-store.ts:105`; UI создания допускает 4–8, но экран блокировки и формы жёстко 6).
- **Крипто-ядро `lib/crypto-vault.ts`** (zero-dependency, чистое WebCrypto): `deriveMasterKey()` — PBKDF2-HMAC-SHA256 **310 000 итераций**, соль 16B → AES-GCM-256 (`crypto-vault:69-88`); верификатор — шифрование константы `'workflow-lock-v1'`; `setMasterSecret`/`verifyMasterSecret`; анти-брутфорс `failDelayMs()` 1s→2s→4s… потолок 30s + `registerFailure`/`resetFailures` (`:239-263`); unit-самотест `cryptoSelfTest()` (`:309`). Есть `encryptSecret/decryptSecret(masterSecret, fileId, plaintext)` — соль выводится из id объекта.
- **`lib/lock-store.ts`**: конфиг `wf.lock.config` (`{enabled, method, autoLockMin, createdAt}`), синхронный bootstrap `readLockBootstrap()` — статус читается **до первого рендера** (п.10.1); `wipeLockData`, `countFileKeys`, BroadcastChannel-синк (`LOCK_CHANNEL_ID='workflow-lock'`, типы `'lock' | 'unlock-config-changed'`), аудит `auditLockState()`.
- **Экран блокировки `components/screen-lock.tsx`**: рендерится ПОВЕРХ app-shell при `v.lock.status==='locked'` (app-shell:182); PIN — 6 ячеек с автопереходом и вставкой из буфера (`onCellPaste:159`); пароль — одно поле с show/hide; busy+cooldown; сцена «хранилище» (meteors-порт, retro-grid). На успехе: `v.unlock()` → `adoptMasterSession(secret)` (принимает мастер в память сессии для wrapped-ключей) → `completeUnlock()`.
- **Состояние в `lib/vault-store.tsx:838-1196`**: `LockView {status:'off'|'locked'|'unlocked', method, autoLockMin, busy, cooldownUntil, failCount, lockedAt}`; действия `setupLock/changeMaster/disableLock/lockNow/unlock/completeUnlock/setAutoLock/resetLock`. **Unlock-факт только в памяти вкладки**; автоблокировка — setInterval 5с против `activityRef` (активность = click/keydown/pointermove, throttle 10с, vault-store:1109-1126); lockNow сбрасывает все фокусы + наращивает `lockEpoch`.
- **Синк вкладок:** BroadcastChannel + storage-события (vault-store:1144-1196); lockNow закрывает все вкладки, unlock не переносится.
- **SSR-защита:** inline-bootstrap в `<head>` (`app/layout.tsx:48-52`) ставит класс `lock-pending` до гидратации.
- **Уровень B — файловые ключи (`hooks/use-file-keys.ts`)**: случайный 32B fileKey оборачивается **двумя факторами** — мастер-ключом сеанса (`wct/wiv`) и паролем файла PBKDF2(пароль, salt=SHA-256('wf.filekey.'+id)) (`pct/piv`) — в `localStorage['wf.vault.keys.<id>']`; верификатор ключа `kct/kiv`; опционально шифрованный `desc` (`dct/div`). Хук: `isProtected/isOpen/openDescOf/packSecret/checkSticker/setFileKey/openWithFileKey/forgetKey`. Мастер-ключ живёт в модульной переменной `masterRef` сессии, обнуляется при потере статуса 'unlocked' (п.10.8). Одноразовая миграция стикеров `migrateLockedNotes` (п.10.6, маркер `wf.vault.keys.migrated`).
- **Redact-слой `lib/redact-context.tsx`**: список id из `wf.filekeys.lockedlist` минус открытые в этой вкладке = `redactIds`; `markUnlocked(id)` — точка интеграции.
- **Ключ-файлы (разблокировка файлом-ключом): отсутствует** — только PIN/пароль. Не путать с «файловыми ключами» (пароли на объекты).
- **Интеграция в UI:** `screen-library.tsx:131` (`useFileKeys`), модалки ввода/установки ключа (fkAsk/fkSetFor, `:399-450`); экран настроек: `components/security-section.tsx` (525 строк) — создание PIN/пароля (двойной ввод, сила пароля), автоблокировка сегментом, смена мастера, выключение.

## 3. Хранилище

Всё в **localStorage** через `hooks/use-persisted-state.ts` (42 строки: default до эффекта чтения — защита от гидратационных ям; fallback на память в приватном режиме). IndexedDB — **отсутствует** (в роадмапе).

| Ключ | Содержимое |
|---|---|
| `wf.files.v1` / `wf.notes.v1` / `wf.chat.v1` | корпус / стикеры / разговоры |
| `wf.chat.active` / `.drafts` / `.scroll` | активная сессия, черновики, скроллы |
| `wf.settings.v1` / `wf.notifs.v1` | настройки (draft/save), лента (макс 40) |
| `wf.lock.config` / `wf.lock.state` | конфиг замка / salt+verifier+failCount+cooldown |
| `wf.vault.keys.<id>` / `.migrated` | wrapped-ключи (`ct:iv`) / маркер миграции |
| `wf.filekeys.lockedlist` / `wf.lock.ping` | redact-список / ping-сигнал вкладок |
| `wf-nav` | свернут ли сайдбар |

**stats** (`vault-store:1252-1273`): `files, notes, links, nodes, bytes, quota(=128МБ), usedPct, processing, sessions, model, modelRam, tokensPerSec, engine, offline, indexedAgo` — производные от `buildGraph()` (`lib/graph.ts`). Счётчики сайдбара: library→files, map→links, chat→sessions.

**Стикеры** (`lib/notes.ts`): `Note {id, title, body, tags, expiresAt|null, lifeSpan, locked, secret, pinnedTo?, createdAt}`; TTL 1ч/24ч/7д/навсегда (`TTL_OPTIONS`), `isAlive()`, демо `seedNotes()`. Секрет хранится как `ct:iv` при активной миграции, иначе plaintext (демо-режим). Действия в vault-store: `addNote/patchNote/burnNote/extendNote/notesFor`. **Стикеры можно переиспользовать** — они уже в общем сейфе, видны поиску/карте/чату, приколоты к файлам через `pinnedTo`.

## 4. Поиск

- **`lib/search.ts`** — единственная функция `searchAll(query, scope, input)`: области `SCOPES = all|semantic|names|notes`; словарь синонимов `SYNONYMS` (вместо эмбеддингов), стемминг-обрубок, веса (имя файла 60, desc 26, теги 22…). Возвращает `Hit {key, kind, id, title, sub, score, fuzzy?, locked?}`.
- **Виды хитов:** `'file' | 'note' | 'chat' | 'cluster' | 'setting'` — **перечисление закрытое**; новый вид = правка `HitKind`, `HIT_ICON`/`KIND_LABEL` в `command-palette.tsx:19-33` и ветка в `runHit` (vault-store:1343).
- **Redact встроен:** `SearchInput.redactIds` — по этим id счёт только по имени, `sub='Под ключом'`, `locked:true` (search.ts:127-152).
- **Расширение палитры:** `SETTING_ENTRIES` (search.ts:55-61) — массив `{id,title,sub,words}` для поиска по разделам настроек; FOCUS_ALIAS в screen-settings маппит их на секции.
- **Хиты куда попадают:** `v.hits` в vault-store (useMemo на query+scope+redactIds) → inline-панель топбара (первые 7, app-shell:160,354) → палитра Ctrl+K (первые 20) → `matchedFiles` подсвечивает карту/библиотеку. Расширяемо: добавить источник в `searchAll` достаточно.

## 5. Настройки (`components/screen-settings.tsx`)

- Секции — массив `SECTIONS` (`:75-82`): engine, pipeline, notify, storage, privacy, danger; каждая `<section id="set-<id>">`; рельс справа со scroll-spy; `FOCUS_ALIAS` (`:85`) переводит id из поиска; подсветка `sec-flash` 1.2с.
- Чекбоксы — `ToggleId` (vault-store:86-95): `ocr|autotag|watch|redact|telemetry|ntfPipeline|ntfPrivacy|ntfDigest` в `Settings.toggles`; рендер через helper `rows()` + toggle-кнопка `role="switch"`; draft/save/revert c индикатором `dirty` в статус-баре.
- **`SecuritySection` монтируется прямо между privacy и danger (`screen-settings.tsx:551`)** с `id="set-security"` — готовый паттерн: новая секция = своя секция с `id="set-<id>"` + запись в `SECTIONS` + (опц.) в `FOCUS_ALIAS` и `SETTING_ENTRIES`.
- Прочее: выбор движка (local/hybrid/cloud, `lib/data.ts:254`) и модели (qwen/llama/mistral), папка сейфа (плейсхолдер, выбор недоступен в прототипе), конвейер-диаграмма, опасная зона (clearIndex / wipeVault с двойным подтверждением).

## 6. Заметки/стикеры — см. п.3

Переиспользуемость подтверждена: данные в сейфе (`wf.notes.v1`), крипто уже на них (`packSecret`/`checkSticker` — образец того, как новому модулю прятать значения), UI — в `screen-library.tsx` (доска заметок, инспектор). Вынести можно, поменяв только место рендера, модель и действия трогать не нужно.

## 7. Буфер обмена

Есть, точечно: `components/chat/message-ai.tsx:115` — копирование текста ответа (`navigator.clipboard.writeText`); `components/screen-chat.tsx:252` — экспорт разговора в Markdown (clipboard + скачивание файла), причём **с redact-фильтрацией цитат** (`redactIds.has(s.fileId)` → «источник под ключом»); `screen-lock.tsx:159` — вставка PIN из буфера (readText только через paste-событие). Специализированной работы с clipboard (менеджер истории) — **отсутствует**.

## 8. Глобальные хоткеи

| Комбо | Где | Что |
|---|---|---|
| **Ctrl/Cmd+Shift+L** | `lib/vault-store.tsx:1129` **и дублирующе** `app-shell.tsx:120` (оба `window.addEventListener('keydown',…,true)`) | lockNow() |
| Ctrl/Cmd+K | `vault-store.tsx:1363` | палитра (toggle) |
| Ctrl/Cmd+F | `screen-chat.tsx:315` | поиск по истории чата |
| Ctrl/Cmd+Enter | `chat/composer.tsx:170` | отправка сообщения |

Регистрация — на `window` с capture, в `useEffect`. Внимание: Ctrl+Shift+L зарегистрирован **дважды** (пехотная избыточность, lockNow идемпотентен). Ctrl+L сознательно не занят (конфликт с браузером, план п.10.10).

## 9. Дизайн-система «Графит» (`app/globals.css`, 8733 строки, слои v3→v4.2)

- **Токены** (`:15-50`): фоны `--bg #030507, --bg-2, --panel, --panel-2, --bg-input`; границы `--border (rgba 255,.06) / --border-2 / --border-3`; текст `--text/-2/-3/-3r`; акцент **`--accent #2fbe7e`** (+hover, `--on-accent`, `--accent-line`); семантика `--ok/--warn/--danger/--info`; радиусы `--r:3px, --r-panel:4px`; shadcn-мост `--color-background/foreground`, `--font-sans/mono`.
- **Шрифты:** IBM Plex Sans (400/500/600) + IBM Plex Mono (400/500), latin+cyrillic, через `next/font` в `app/layout.tsx:8-20` (переменные `--font-plex-sans/mono`).
- **Законы:** без blur/box-shadow/полупрозрачных пятен (глубина тонами и волосяными границами); один акцент; числа `tabular-nums` (класс `.num`); transition точечно (никогда `all`); `prefers-reduced-motion` глушит всё глобально; новые стили — **отдельным слоем в конце файла** (паттерн `/* ===== FILE-KEYS v3.2b ===== */` на `:7179`).
- **Классы:** `app, sidebar, nav, nav-item(.active/.nav-sub), nav-section, nav-count, btn (-primary/-ghost/-tertiary/-danger/-sm/-lg), panel, badge (-ok/-warn/-danger/-info), chip, toggle, input, select, label-mono, mono, num, icon-btn, kbd-btn, sec/sec-head/sec-icon/sec-meta/sec-note, setting-row, rows-list, set-page/set-rail/set-main/set-hero, cmdk-*, dd-* (дропдаун), search-pill/search-panel/search-row, engine-pill, storage-bar, flash-toast, lock-* (весь экран замка), lf-* (формы ключей), mark-*/mask-* (маскирование)`. Иконки — строковые `IconId` → `components/icons.tsx` (61 иконка, currentColor, 621 строка).

## 10. Приёмка проекта

- **`npx tsc --noEmit`** — главный гейт; проверен в этой сессии: **exit 0, чисто**. `tsc` в `node_modules/.bin/tsc`, `tsconfig.tsbuildinfo` на месте (incremental).
- `pnpm dev` (порт 3457 в этом каталоге: `allowedDevOrigins: ['127.0.0.1','localhost']` в `next.config.mjs` — без него Next 16 «мёртвая страница»), `pnpm build`/`pnpm start`.
- **`next.config.mjs`: `typescript.ignoreBuildErrors: true`** — build не ловит типы, поэтому tsc руками обязателен.
- Доки: **`LOCK-FEATURE-PLAN.md`** (362 строки: полный план замка + аудит логических цепочек пп.10.1–10.13 — обязательное чтение перед крипто-работой), **`AGENTS.md`/`CLAUDE.md`** (кастомный Next 16 — перед незнакомым кодом читать `node_modules/next/dist/docs/`), `README.md` (335 строк, точная карта).
- Эмпирические тесты доски: `node --experimental-strip-types` (сценарии из react-draggable-boards); крипто-самотест — `cryptoSelfTest()` из консоли. Сущ. тестовой инфраструктуры (vitest/jest) — **отсутствует**.

## Вывод: фундаменты, которые обязан переиспользовать модуль «Менеджер секретов»

1. **Крипто-ядро `lib/crypto-vault.ts` + сессия мастера из `hooks/use-file-keys.ts`** — PBKDF2/AES-GCM уже готовы, `packSecret/ct:iv` и двухфакторная обёртка — образцы; новый vault не должен изобретать свою крипту, только строить на `masterRef`-сеансе.
2. **Жизненный цикл замка в `lib/vault-store.tsx`** — `lock/lockNow/unlock/completeUnlock/lockEpoch` + красакт `redact-context`: секреты обязаны исчезать из памяти и из UI при lockNow и попадать в redact-слой поиска/чата/экспорта.
3. **Единый сейф `useVault`** — все данные/действия/счётчики/тосты/уведомления через контекст; новое состояние — поля и actions в VaultCtx, а не отдельный store.
4. **localStorage-паттерн `use-persisted-state` + префикс `wf.*`** и синхронный bootstrap-приём из `lock-store.ts` (для любых данных, которые нельзя «мигнуть» до гидратации).
5. **Навигация/поиск/настройки:** ScreenId-переключение в `page.tsx`+`app-shell` (замкнутые Record'ы), `HitKind`/`searchAll`/`runHit` (новый вид хита), `SECTIONS`/`set-<id>`/`FOCUS_ALIAS`/`SETTING_ENTRIES` (секция настроек).
6. **Дизайн-система «Графит»** — токены, `.panel/.btn/.nav-item/.num/.label-mono`, слой CSS отдельным блоком, без blur/теней, `prefers-reduced-motion`.

Проверено исполнением: `tsc --noEmit` → exit 0. Ничего в проекте не изменялось — только чтение.