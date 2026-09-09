# Статус: прод-доводка desktop (2026-09-09) — исполнитель WorkSpaceX-desktop

Зона: main.mjs, preload-workspace.cjs, ui/setup.*, installer.nsi, runtime.env, ollama-release.json, app/login.

## P1. Иконки окон — ГОТОВО
- `desktop/src/main.mjs`: обеим `BrowserWindow` (setup в `localWizard`, workspace в `openWorkspace`) добавлен `icon: path.join(here, '../assets/icon.png')`. Фоновые цвета окон приведены к палитре «Графит» (#070a0c / #030507).

## Мост pickFolder — ГОТОВО
- `preload-workspace.cjs`: новый метод `pickFolder()` → `ipcRenderer.invoke('workspacex:pick-folder')`.
- `main.mjs`: `handleWorkspace('workspacex:pick-folder')` → `dialog.showOpenDialog(workspace, { properties: ['openDirectory', 'createDirectory'], title: 'Выберите папку хранения' })`, возвращает `filePaths[0]` либо `null` (отмена). Trusted-проверка workspace-окна — как у остальных методов моста.

## P3-часть. Модель qwen2.5vl:3b — ГОТОВО
- `desktop/ollama-release.json`: `model: qwen2.5vl:3b`, `modelBytes: 3400000000`, новый `modelLabel: 'Qwen2.5-VL 3B · зрение + текст'`, `modelLicense: Apache License 2.0` (проверено по странице реестра Ollama: у qwen2.5vl:3b лицензия Apache 2.0, blob 832dd9e00a68, модель 3.2GB Q4_K_M), `modelLicenseUrl: https://ollama.com/library/qwen2.5vl:3b/blobs/832dd9e00a68`.
- `main.mjs`: `setup:license` открывает новый URL лицензии.
- `desktop/runtime.env`: `OLLAMA_MODEL=qwen2.5vl:3b`, `NEXT_PUBLIC_AI_MODEL_LABEL=Qwen2.5-VL 3B`.

## P9. Мастер настройки — ГОТОВО
- `desktop/ui/setup.html/css/js` переписаны: визуальная система «Графит» v3 (токены app/globals.css + паттерны app/styles/access.css): графитовый фон с радиальным градиентом как у access-scene, карточка #0c1114, акцент #2fbe7e/#35c287, 44px-инпуты, фокус/ disabled/hover-состояния, IBM Plex Sans.
- Логотип-иконка assets/icon.png в шапке (data-testid setup-logo).
- Визард из 4 шагов с рельсом в aside: 01 Роль компьютера → 02 Данные доступа → 03 Загрузка ИИ (чип «qwen2.5vl:3b · 3,2 ГБ · зрение + текст», прогресс с ГБ и %) → 04 Готово. Кнопки «← Выбрать другую роль».
- Все 51 прежних data-testid сохранены, добавлены 9 новых (setup-logo, setup-steps, setup-step-role/form/download/done, setup-model-download-info, setup-back-role, setup-back-role-client). Автопроверка: 60 testid, все id-ссылки setup.js существуют.
- Прогресс-фазы (starting/engine-download/verify/extract/model-download/warmup/app-ready/ready) переводят визард на шаг 3 автоматически; ошибка на шаге 3 показывает «Повторить».
- Экран входа `app/login/page.tsx` проверен: уже в единой системе (access-scene/access-card + LogoWord, те же акценты и фоны) — изменений не требует; фон мастера выровнен под access-scene.

## P10. Удаление с данными — ГОТОВО
- `desktop/assets/installer.nsi`: между MUI_UNPAGE_CONFIRM и MUI_UNPAGE_INSTFILES добавлена кастомная страница `UninstPage custom un.PageData un.PageDataLeave` (nsDialogs, MUI2-заголовок): чекбокс «Удалить также базу, модель и все данные (папку WorkSpaceX в профиле)» — по умолчанию ВКЛ (`${NSD_Check}`), пояснение, что именно удаляется.
- При ВКЛ: `RMDir /r "$APPDATA\WorkSpaceX"` (только текущий пользователь, SetShellVarContext current); текст MessageBox перед удалением зависит от выбора. Установочная секция и реестр не тронуты.

## Верификация
- `node --check`: main.mjs, preload-workspace.cjs, setup.js — OK. ollama-release.json — валидный JSON (lint при записи).
- NSIS-скрипт проверяется полной сборкой координатора (синтаксис MUI2 + UninstPage custom по канону NSIS).
- Не делал: npm/pnpm install, сборка.
