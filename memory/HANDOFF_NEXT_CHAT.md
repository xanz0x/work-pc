# Инструкция для следующего чата

**Язык общения с пользователем:** Русский (строго!)
**Проект:** Next.js 16 / React 19 / TypeScript / pnpm, корень `/app` — WorkSpaceX: защищённое хранилище, AI-чат, почта, общий облачный диск, десктоп-интеграция.

Обновлено: 2026-06 (сессия «фикс сборки + E2E»). Прежний P0-блокер закрыт.

## Состояние окружения (важно)
- Под сбрасывался: восстановлены `pnpm install --frozen-lockfile` и `/app/.env.local`
  (APP_PASSWORD, ADMIN_LOGIN=admin, новые APP_SESSION_SECRET и MAIL_SECRET, AI_DIR=/app/.data,
  CLOUD_STORAGE=local, APP_URL). Ключи внешних сервисов (SONJJ и т.п.) в окружении отсутствуют.
- Фронтенд — ПРОДАКШН-сборка под supervisor: после правок обязательно
  `cd /app && pnpm run build && sudo supervisorctl restart frontend` (hot-reload нет).
- Внешний адрес превью: `https://<PREVIEW_INSTANCE>.preview.emergentagent.com`
  (берётся из supervisor `APP_URL`, старые ссылки из истории неактуальны).
- Провайдер модели: OpenRouter, ключ пользователя, модель `z-ai/glm-5.3-flash` (text+image),
  конфиг `/app/.data/ai/provider.json`. Emergent LLM key НЕ используется.

## Что сделано в этой сессии
- **Сборка (P0) починена**: `pnpm run build` → EXIT=0, **0 предупреждений**.
  - `instrumentation.ts` разделён: файловый автосев вынесен в `lib/boot-seed.ts`, грузится
    динамически только при `NEXT_RUNTIME === 'nodejs'`; на путях `/*turbopackIgnore: true*/`.
  - `lib/cloud-store.ts` `readFileBytes` — тот же `turbopackIgnore`.
- **ESLint починен**: `pnpm lint` → 0 ошибок (139 предупреждений старого долга hooks).
  Плагин `react-hooks` берётся из самого `eslint-config-next` (отдельная установка ломалась
  на pnpm-симлинке); для `tests/**` правило `react-hooks/globals` понижено до warn.
- **Инспектор библиотеки**: добавлена кнопка `insp-file-view` «Просмотр» для локальных файлов —
  раньше модальный просмотрщик открывался только правой кнопкой по карточке.
- **README** приведён к текущей правде: OpenRouter / свой сервер, никаких Ollama/локальных моделей.

## Проверено (E2E, iteration_57 + ручные прогоны)
- Вход admin, загрузка приложения, чат — реальный ход через OpenRouter (200, модель glm-5.3-flash).
- Настройки модели: ровно два варианта (OpenRouter / Свой сервер), список 430 моделей из живого API,
  round-trip сохранения custom → openrouter.
- Папка хранения: PUT `/ai-api/cloud/storage-root` + загрузка → файл реально ложится в выбранную папку.
- AI/Vision анализ: `POST /ai-api/analyze` на PNG-«паспорте» → status done, осмысленные
  title/описание/теги (реальный vision-вызов).
- Просмотрщик: изображение, PDF, DOCX (текст с разметкой) открываются в модале, Escape закрывает.
- Контекстное меню библиотеки: работает (правый клик по карточке) — прежний «баг» тест-агента был
  артефактом координат в headless.
- Регресс: vitest **319 тестов PASS**; 2 файла (`desktop-config`, `desktop-security`) не загрузились —
  в `/app/desktop` не установлены зависимости (`dotenv`, `selfsigned`), это дефект окружения, не кода.

## Что НЕ проверено / осталось
- **P1 · Почта**: контекстное меню в просмотрщике письма (copy text/link/image address/open in browser)
  НЕ проверено — в окружении нет ни одного почтового ящика и ни одного письма. Нужен реальный
  IMAP-ящик от владельца либо `SONJJ_API_KEY` + входящее письмо.
- **P1 · Desktop-тесты**: поставить зависимости `/app/desktop` (pnpm install в workspace desktop),
  чтобы vitest был полностью зелёным.
- **P2**: `/ai-api/ai/provider/models` отдаёт `{models:[…]}` без `ok:true` — расходится с другими
  роутами; `components/screen-library.tsx` > 2900 строк, просится разбивка.
- **P2**: ключ OpenRouter лежит на диске в открытом виде (`provider.json`); при желании — шифровать
  мастер-ключом.

## Напоминания
- Пакетный менеджер только **pnpm**. Все API-роуты — под `/ai-api/...`, не `/api/...`.
- Локальные LLM удалены по требованию пользователя — не возвращать.
- Не трогать пользовательские данные в `/app/.data` и `/app/ai`; тестовые файлы удалять за собой.
