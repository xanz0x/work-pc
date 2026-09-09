# Статус: серверный конвейер анализа файлов (раздел 2, 2026-09-06)

Дата: 2026-09-08 · Исполнитель: subagent «WorkSpaceX: серверный конвейер анализа файлов»

## Сделано
- **lib/file-analyzer.ts** (новый) — конвейер анализа:
  - `detectKind(name, mime)` → text / code / markdown / pdf / docx / archive / image / unknown (расширение спасает при общем mime, однозначный mime сильнее расширения; SVG — текст);
  - текст/код/MD — прямое чтение (UTF-8, NUL вычищаются, выборка 4000 симв.);
  - PDF — pdf-parse (ленивый `createRequire` в рантайме, без бандла pdf.js при старте);
  - DOCX — `mammoth.extractRawText`;
  - ZIP — adm-zip: список имён + тексты ≤10 файлов по ≤2 МБ (выборка 1200 симв. на файл, защита от битых/зашифрованных элементов);
  - изображения — exifreader (размер, дата съёмки, камера, ISO/выдержка/…) + vision moondream: проверка в `/api/tags`, докачка через `/api/pull` (NDJSON-поток до success), описание через `/api/chat` с `images:[base64]` и промптом «Опиши фото: … ≤40 слов»;
  - qwen2.5:3b: `/api/chat` (stream:false) — строго JSON `{"title": ≤8 слов, "description": ≤40 слов}`; устойчивый разбор (чистый JSON / markdown-забор / JSON в окружении текста) с fallback на имя файла и первые строки;
  - статусы: `done` / `partial` (EXIF без vision, модель вернула мусор или недоступна, файл >50 МБ) / `failed` (не прочитан или не извлечён) — причина человекочитаемо по-русски;
  - лимиты: файлы >50 МБ целиком не читаются; содержимое в логи не пишется.
- **app/ai-api/analyze/route.ts** (новый):
  - `POST /ai-api/analyze {objectId}` — проверяет доступ (NOT_FOUND/FORBIDDEN), ставит `analysisStatus:'queued'` в метаданные и запускает фоновую работу; очередь in-memory Map, повторный POST — повторный анализ; ошибки фоновой работы оседают в статусе;
  - `GET /ai-api/analyze?objectId=…` — статус из очереди, а после перезапуска сервера — сохранённый результат из метаданных.
- **lib/cloud-store.ts** — расширение уже присутствовало (согласовано): `CloudAnalysisKind`, поля `title/description/analysisStatus/analysisKind/analyzedAt/analysisError`, `getAnalysisInput`, `setFileAnalysis` — конвейер использует только их, файл не правился.
- **tests/unit/file-analyzer.test.ts** (новый) — 38 тестов без настоящей модели: ZIP собирается в памяти adm-zip (список, лимиты 2 МБ/10 файлов, битый архив), DOCX через mock mammoth, разбор ответа модели на fixture-строках, fallback-описания, exif-сводка, детект типа.

## Верификация
- `node_modules/.bin/tsc --noEmit` — чисто (exit 0).
- `node_modules/.bin/vitest run tests/unit/file-analyzer.test.ts` — 38 passed (38).
- Зоны других исполнителей не тронуты (app/ai-api/cloud/**, components/**, desktop/**).

## Контракт
```
POST /ai-api/analyze  {objectId}      → 202 {objectId, status:'queued'} | 400/403/404 (INVALID_ARGS/FORBIDDEN/NOT_FOUND)
GET  /ai-api/analyze?objectId=…       → {objectId, status:'queued'|'running'|'done'|'partial'|'failed'|null, error?, finishedAt?|startedAt?}
                                        либо сохранённый результат: {status, title, description, kind, analyzedAt, error?}
метаданные объекта (drive.json):      title, description, analysisStatus, analysisKind, analyzedAt, analysisError
```
