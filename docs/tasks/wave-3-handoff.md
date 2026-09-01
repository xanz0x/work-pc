# Волна 3 · Передача дел (что сделано, что осталось)

> Файл-инструкция для продолжения в новом чате. Обновлено 06.2026.
> Полные ТЗ по каждой задаче — в `docs/tasks/wave-3.md`. Здесь — краткий статус
> и пошаговый план «что делать дальше».

---

## 1. Статус задач Волны 3

| Задача | Статус | Кратко |
|--------|--------|--------|
| NF-1 · Индексатор файлов | `DONE*` | Код готов, юнит-тесты зелёные. **Осталась ручная приёмка** на реальной папке ~1 000 файлов. |
| AR-1 · Разделение стора и часов | `DONE` | Домены вынесены (`clock/toast/settings/notifs/data/lock/nav/engine`), `useVault()` — фасад. Цифры ререндеров сняты автотестом. |
| AR-2 · Code splitting экранов | `DONE` | `next/dynamic` + префетч, `globals.css` разрезан. Свой JS первого бандла −58 %, CSS −50 %. |
| NF-2 · Локальный движок (Ollama) | `DONE` | `lib/llm/*`, гейт живости, честная плашка «движок не найден», метрики из ответа движка. |
| **Узкие подписки (map + library)** | `DONE` | `screen-map.tsx` и `screen-library.tsx` переведены с `useVault()` на `useDataStore/useNavStore/useLockStore`. |
| NF-4 · Онбординг из трёх шагов | `TODO` | **Не начато.** Нет `components/onboarding.tsx`. |
| LG-3 · Журнал безопасности | `TODO` | **Не начато.** Нет `lib/journal.ts`. |

`DONE*` — код завершён и покрыт тестами, ждёт финальной ручной приёмки.

---

## 2. ⚠️ Важно: работа НЕ закоммичена

Весь код NF-2 и узких подписок лежит в рабочем дереве git, но **не сохранён в
коммит**. Новые файлы (untracked):

```
app/ai-api/engine/          # маршрут статуса движка
components/engine-panel.tsx  # плашка «движок не найден»
lib/llm/                     # провайдеры: index, ollama, cloud, fail, types, models
lib/store/engine.tsx         # домен движка
lib/store/nav.tsx            # домен навигации
scripts/fake-ollama.mjs      # заглушка Ollama для тестов UI
scripts/narrow-subscriptions.py
tests/unit/llm.test.ts       # 16 юнит-тестов LLM
test_reports/iteration_15.json
```

Изменённые (modified): `app/ai-api/chat/route.ts`, `components/screen-map.tsx`,
`components/screen-library.tsx`, `components/screen-chat.tsx`,
`components/screen-settings.tsx`, `components/app-shell.tsx`,
`lib/vault-store.tsx`, `lib/store/settings.tsx`, `lib/ai-errors.ts` и др.

**Первое действие в новом чате:** сохранить это через кнопку **«Save to Github»**
в поле ввода чата, чтобы не потерять сделанное.

---

## 3. Что осталось доделать до закрытия Волны 3

### 3.1 NF-1 — ручная приёмка (не код, а проверка)
- Прогон на реальной папке ~1 000 файлов: фоновая индексация без фризов UI,
  корректный процент и работающая отмена.
- Проверить фолбэк `<input webkitdirectory>` в браузере без File System Access
  API (Firefox/Safari).
- Убедиться, что повторный запуск реально пропускает неизменённое (счётчик
  `skipped` растёт по хешу SHA-256).

### 3.2 NF-4 — Онбординг из трёх шагов `TODO`
Файлы: новый `components/onboarding.tsx` · `lib/vault-store.tsx` · `app/page.tsx`
1. Шаг 1: режим приватности (локальный / гибридный) с раскрытием того, что уходит.
2. Шаг 2: создание мастер-ключа (PIN 6 или пароль) — не пропускать молча, отказ
   фиксировать явно.
3. Шаг 3: выбрать папку (NF-1) или «посмотреть демо».
4. Флаг прохождения в настройках; повторный вход онбординг не показывает.

Готово когда: новый пользователь начинает с включённой защитой; отказ от шагов
не оставляет систему в полудоверенном состоянии.

### 3.3 LG-3 — Журнал безопасности `TODO`
Файлы: новый `lib/journal.ts` · `lib/vault-store.tsx` · `lib/secrets-store.tsx`
· `components/security-section.tsx`
1. Append-only журнал в IndexedDB: смена мастера, сброс замка, plaintext-экспорт,
   восстановление бэкапа, wipe, «ИИ сохранил пароль», облачные запросы.
2. Журнал не чистится из UI и не участвует в retention уведомлений.
3. Просмотр с фильтром по типу, экспорт в файл.
4. Уведомления ссылаются на запись журнала.

Готово когда: все критические действия попадают в журнал, он переживает очистку
уведомлений и экспортируется.

### 3.4 Узкие подписки — остальные экраны (по желанию, P1)
Готовы `screen-map` и `screen-library`. Ещё на фасаде `useVault()`:
`screen-chat.tsx`, `screen-lock.tsx`, `screen-settings.tsx`. Переводить по одному
экрану на `useDataStore/useNavStore/useLockStore`, когда дойдут руки.

---

## 4. Как запускать и проверять

```bash
# прод-сборка (dev с Turbopack в этой среде отдаёт 403 на чанки)
cd /app && pnpm build && node_modules/.bin/next start -p 3000 -H 0.0.0.0

# после каждой пересборки обязателен рестарт воркера, иначе старый процесс
# держит манифест прежней сборки и отдаёт 500 на новые чанки:
pkill -f next-server && node_modules/.bin/next start -p 3000 -H 0.0.0.0 &

# гейты
npx tsc --noEmit          # 0 ошибок — главный гейт
pnpm test                 # vitest (unit)
pytest tests/api/         # API
pnpm exec playwright test # e2e

# проверить UI локального движка без реальной модели:
node scripts/fake-ollama.mjs   # заглушка Ollama на :11434
```

Вход в приложение: пароль `IceKrymTeam13@` (см. `/app/memory/test_credentials.md`).

---

## 5. Ключевые точки NF-2 (локальный движок)

- Контракт провайдера: `lib/llm/types.ts` → `stream(...) → AsyncGenerator<LlmDelta>`.
- Ollama-адаптер: `lib/llm/ollama.ts` (`POST /api/chat`, NDJSON, `probeOllama()`
  через `GET /api/tags`). Адрес по умолчанию `http://localhost:11434`,
  переопределяется `OLLAMA_URL`.
- Выбор провайдера: `lib/llm/index.ts` → `resolveProvider(engine, model)`.
  «Локальный» → Ollama, «Гибридный/Внешняя модель» → облако. Если локальный
  движок не готов — маршрут отвечает **409** и говорит, что сделать (тихой
  подмены на облако нет).
- Карта моделей: `lib/llm/models.ts` (`qwen-7b` → `qwen2.5:7b`).
- Коды ошибок: `ENGINE_NOT_RUNNING`, `MODEL_NOT_PULLED` (`lib/ai-errors.ts`).
- Статус движка: `GET /ai-api/engine?model=…`.
- Домен движка: `lib/store/engine.tsx` (статус, перепроверка, метрики).
- Плашка: `components/engine-panel.tsx` (`data-state = checking|ok|off|error`,
  код в `data-code`, кнопка «Проверить снова»).

---

## 6. Долги / оговорки

- `pnpm lint`: предупреждения react-hooks (purity/refs) — прежний долг, не блокер.
- `webgpu`-провайдер в `lib/llm/` — на будущее, ещё не написан.
- `screen-map.tsx` разросся (~1.9 тыс. строк) — можно разбить на модули (не блокер).
- Ollama в этой среде мокается через `scripts/fake-ollama.mjs`; настоящая модель
  на диске отсутствует — финальная приёмка на реальной Ollama остаётся за кадром.
