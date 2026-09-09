# Статус: почта (картинки/ссылки), список моделей, мост Electron — 2026-09-08

Задачи §5, §6, §7 из `2026-09-06-features.md`.

## §5 Почта
- [x] **Картинки грузятся всегда.** Блокировка была в `components/mail/mail-msg-view.tsx` (frameDoc): CSP `img-src 'none'`, пока пользователь не нажмёт «Показать картинки». Теперь `img-src https: http: data: cid:` безусловно; переключатель и подсказка «Внешние картинки выключены…» удалены. Sanitizer (`lib/mail-html.ts`) и sandbox iframe (`allow-popups`, без `allow-scripts`) не тронуты — скрипты запрещены и CSP, и sandbox.
- [x] **ЛКМ по ссылке/кнопке письма** → браузер по умолчанию: письмо рендерится с `<base target="_blank">`, клик из sandbox-iframe приходит в `setWindowOpenHandler` workspace-окна (`desktop/src/main.mjs`) — внешние http(s) уходят в `shell.openExternal`, окно не создаётся (всегда deny).
- [x] **ПКМ** → React-меню поверх письма (`components/mail/mail-context-menu.tsx`, монтируется в MailMsgView): «Открыть ссылку в браузере» (через `workspacexDesktop.openExternal`), «Копировать адрес ссылки» и «Копировать текст» (`navigator.clipboard`). Событие ПКМ из sandbox-iframe до React не доходит — главный процесс ловит `webContents.on('context-menu')` для кадров `about:srcdoc` и пересылает в страницу (`workspacex:context-menu`); MailMsgView показывает меню, если клик попал в его iframe. В браузере (dev, без моста) остаётся нативное меню — не Electron-фича.

## §6 Настройки: список моделей
- [x] **Новый эндпоинт `app/ai-api/models/route.ts`** (`GET /ai-api/models?model=<id>`): теги из `GET <OLLAMA_URL>/api/tags` через существующий серверный проб (`localStatus` из `lib/llm` — браузер в localhost не стучится). Ответ: `{ ok, base, models: string[], active: string|null, code, hint }`; `active` — тег выбранной модели, если реально установлен. Сессия закрывается proxy.ts (matcher `/ai-api/:path*`) — как `/ai-api/engine`.
- [x] **`components/screen-settings.tsx`**: селектор моделей заполняется только установленными в Ollama (тег → модель профиля через `OLLAMA_TAGS` с допуском суффикса квантования, как `hasModel` в `lib/llm/models.ts`); захардкоженный список MODELS в списке не участвует. Активная помечена «· активная». Пусто → «Локальная модель ещё не скачана» (`data-testid="settings-model-empty"`); запрос не дошёл → «Не удалось получить список моделей…»; грузится → «Уточняем список моделей…». Обновляется вместе со статусом движка («Проверить снова»). Бейдж `model-state` и статистика без изменений.

## §7 Мост Electron
- [x] **Новый `desktop/src/preload-workspace.cjs`**: `contextBridge.exposeInMainWorld('workspacexDesktop', { openExternal(url), revealInExplorer(absPath), openPath(absPath), onContextMenu(cb) })`. Контракт совпадает с уже используемым компонентами (`cloud-section`, `screen-library`, `library-viewer` зовут через optional chaining).
- [x] **`desktop/src/main.mjs`** (только добавления; logger.mjs, меню и setup-обработчики не тронуты):
  - `handleWorkspace()` — приём IPC только от workspace-окна: `event.sender.id === workspace.webContents.id`, `event.senderFrame === mainFrame`, URL начинается с `workspaceUrl` (по образцу существующего `handle()`).
  - `workspacex:open-external` — только `http:`/`https:` (new URL), иначе отказ.
  - `workspacex:reveal` / `workspacex:open-path` — путь только внутри папки хранения из `<AI_DIR>/cloud/storage-root.json` (`{ "root": "..." }`, формат `lib/cloud-store.ts`); файла нет/пуст → понятная ошибка «Папка хранения ещё не выбрана…». Reveal — `explorer /select,"path"` (на других ОС `shell.showItemInFolder`), open — `shell.openPath`.
  - preload подключён в `openWorkspace()` (`sandbox: true, contextIsolation: true` сохранены).
  - `setWindowOpenHandler` workspace-окна: внешний http(s) → `shell.openExternal` (с журналированием сбоя), создание окна всегда deny.
- Проверки пути строковые (path.resolve + path.relative): symlink наружу не отслеживается — совпадает с простым форматом storage-root.json.

## Верификация
- [x] `node --check desktop/src/preload-workspace.cjs` и `desktop/src/main.mjs` — ок.
- [x] `node_modules/.bin/tsc --noEmit` — чисто (0 ошибок).
- [x] `node_modules/.bin/vitest run tests/unit` — 277/279 зелёные. Два падения в `tests/unit/indexer.test.ts` (PDF-текст, mojibake) предсуществующие: файлы `lib/indexer/**` и тест не менялись с 2026-09-06 18:25, к почте/настройкам/мосту отношения не имеют. Почта (mail, mail-read, temp-mail), desktop-config/security, llm, store-renders — зелёные.
- Сборка установщика и живой прогон в Electron — за координатором (как в плане).

## Изменённые файлы
- НОВЫЙ `app/ai-api/models/route.ts`
- НОВЫЙ `components/mail/mail-context-menu.tsx`
- НОВЫЙ `desktop/src/preload-workspace.cjs`
- `components/mail/mail-msg-view.tsx`
- `components/screen-settings.tsx`
- `app/styles/screen-mail.css` (стили .mail-ctx-*)
- `desktop/src/main.mjs`
- `.hermes/plans/status-mail-models.md` (этот файл)
