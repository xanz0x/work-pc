# Волна 3 · Передача дел (что сделано, что осталось)

> Файл-инструкция для продолжения в новом чате. Обновлено 06.2026 (после NF-4).
> Полные ТЗ по каждой задаче — в `docs/tasks/wave-3.md`. Здесь — краткий статус
> и пошаговый план «что делать дальше».

---

## 1. Статус задач Волны 3

| Задача | Статус | Кратко |
|--------|--------|--------|
| NF-1 · Индексатор файлов | `DONE*` | Код готов, юнит-тесты зелёные. **Осталась ручная приёмка** на реальной папке ~1 000 файлов. |
| AR-1 · Разделение стора и часов | `DONE` | Домены вынесены (`clock/toast/settings/notifs/data/lock/nav/engine`), `useVault()` — фасад. |
| AR-2 · Code splitting экранов | `DONE` | `next/dynamic` + префетч, `globals.css` разрезан. Свой JS первого бандла −58 %, CSS −50 %. |
| NF-2 · Локальный движок (Ollama) | `DONE` | `lib/llm/*`, гейт живости, честная плашка «движок не найден», метрики из ответа движка. |
| Узкие подписки (map + library) | `DONE` | `screen-map.tsx` и `screen-library.tsx` на `useDataStore/useNavStore/useLockStore`. |
| **NF-4 · Онбординг из трёх шагов** | `DONE` 2026-06-02 | Три шага, отказ от ключа режет облако, флаг в профиле настроек. Юнит + e2e зелёные. |
| LG-3 · Журнал безопасности | `TODO` | **Не начато.** Нет `lib/journal.ts`. |

`DONE*` — код завершён и покрыт тестами, ждёт финальной ручной приёмки.

---

## 2. Что осталось до закрытия Волны 3

### 2.1 LG-3 — Журнал безопасности `TODO`
Файлы: новый `lib/journal.ts` · `lib/vault-store.tsx` · `lib/secrets-store.tsx`
· `components/security-section.tsx`
1. Append-only журнал в IndexedDB: смена мастера, сброс замка, plaintext-экспорт,
   восстановление бэкапа, wipe, «ИИ сохранил пароль», облачные запросы.
2. Журнал не чистится из UI и не участвует в retention уведомлений.
3. Просмотр с фильтром по типу, экспорт в файл.
4. Уведомления ссылаются на запись журнала.

Готово когда: все критические действия попадают в журнал, он переживает очистку
уведомлений и экспортируется.

Точки входа, уже готовые к журналированию: `lib/store/lock.tsx`
(`setupLock/changeMaster/disableLock/resetLock/unlock`), `lib/secrets-io.ts`
(экспорт/импорт), `lib/store/data.tsx` (`wipeVault`), `lib/store/settings.tsx`
(`grantCloudConsent/revokeCloudConsent`, `finishOnboarding` — там же фиксируется
отказ от мастер-ключа при первом запуске).

### 2.2 NF-1 — ручная приёмка (не код, а проверка)
- Прогон на реальной папке ~1 000 файлов: фоновая индексация без фризов UI,
  корректный процент и работающая отмена.
- Фолбэк `<input webkitdirectory>` в браузере без File System Access API.
- Повторный запуск реально пропускает неизменённое (счётчик `skipped` по SHA-256).

### 2.3 Узкие подписки — остальные экраны (по желанию, P1)
Ещё на фасаде `useVault()`: `screen-chat.tsx`, `screen-lock.tsx`,
`screen-settings.tsx`. Переводить по одному экрану.

---

## 3. Как запускать и проверять

```bash
# прод-сборка (dev с Turbopack в этой среде отдаёт 403 на чанки)
cd /app && pnpm build && node_modules/.bin/next start -p 3000 -H 0.0.0.0

# после каждой пересборки обязателен рестарт воркера:
pkill -f next-server && node_modules/.bin/next start -p 3000 -H 0.0.0.0 &

# гейты
npx tsc --noEmit          # 0 ошибок — главный гейт
pnpm test                 # vitest (unit)
APP_URL=$PREVIEW WF_BASE=$PREVIEW python3 -m pytest tests/api -q
PLAYWRIGHT_BROWSERS_PATH=/pw-browsers APP_URL=$PREVIEW pnpm exec playwright test

# проверить UI локального движка без реальной модели:
node scripts/fake-ollama.mjs   # заглушка Ollama на :11434
```

Важно про адрес в тестах: cookie сессии помечена `Secure`, поэтому API- и
e2e-гейты гоняются по **https-адресу превью**, а не по `http://localhost:3000`
(на localhost всё отвечает 401). `pnpm` в этой среде нужен версии 10
(`npm i -g pnpm@10`): 11-я требует Node 22, а стоит Node 20.

Вход в приложение: пароль `IceKrymTeam13@` (см. `/app/memory/test_credentials.md`).

---

## 4. Ключевые точки NF-4 (онбординг)

- Политика — `lib/onboarding.ts`: `needsOnboarding` (кому показывать),
  `shouldMarkOnboarded` (профиль со старым замком засчитать молча),
  `resolveOnboarding` (режим + согласие + понижение при отказе от ключа).
- Разметка — `components/onboarding.tsx`, стили — `app/styles/onboarding.css`
  (свой чанк, в первом бандле их нет). Монтируется в `app/page.tsx` через
  `next/dynamic`.
- Состояние в профиле — `settings.onboarding = { at, mode, keyChoice, start }`
  (`lib/store/settings.tsx`: `finishOnboarding`, `noteOnboarding`, `markOnboarded`).
- Отказ от мастер-ключа принудительно опускает режим до локального и не выдаёт
  согласия на облако — полудоверенного состояния не остаётся.
- `data-testid`: `onboarding` (+ `data-step`), `onb-mode-local|hybrid`,
  `onb-cloud-ack`, `onb-step1-next`, `onb-method-pin|password`, `onb-secret`,
  `onb-secret-repeat`, `onb-create-key`, `onb-key-error`, `onb-decline`,
  `onb-decline-yes|no`, `onb-pick-folder`, `onb-pick-demo`.
- Прежние e2e-сценарии зовут `skipOnboarding(page)` из `tests/e2e/onboard.ts`.

---

## 5. Ключевые точки NF-2 (локальный движок)

- Контракт провайдера: `lib/llm/types.ts` → `stream(...) → AsyncGenerator<LlmDelta>`.
- Ollama-адаптер: `lib/llm/ollama.ts` (`POST /api/chat`, NDJSON, `probeOllama()`
  через `GET /api/tags`). Адрес по умолчанию `http://localhost:11434`,
  переопределяется `OLLAMA_URL`.
- Выбор провайдера: `lib/llm/index.ts` → `resolveProvider(engine, model)`.
  Если локальный движок не готов — маршрут отвечает **409** и говорит, что
  сделать (тихой подмены на облако нет).
- Карта моделей: `lib/llm/models.ts` (`qwen-7b` → `qwen2.5:7b`).
- Коды ошибок: `ENGINE_NOT_RUNNING`, `MODEL_NOT_PULLED` (`lib/ai-errors.ts`).
- Статус движка: `GET /ai-api/engine?model=…`; домен — `lib/store/engine.tsx`;
  плашка — `components/engine-panel.tsx`.

---

## 6. Долги / оговорки

- `pnpm lint`: 0 errors, ~100 warnings react-hooks (purity/refs) — прежний долг.
- E2E `03-chat-tool-call` (три сценария) на превью-адресе нестабилен: после входа
  чанк экрана настроек иногда не доезжает и `engine-cloud` не появляется
  (в сайдбаре пункт уже активен, а контент остаётся прежним). Вручную тот же путь
  проходит; спека раньше вообще пропускалась (`APP_PASSWORD` не передавался).
  Разобраться отдельно — это про AR-2 и раздачу чанков, не про NF-4.
- `webgpu`-провайдер в `lib/llm/` — на будущее, ещё не написан.
- `screen-map.tsx` разросся (~1.9 тыс. строк) — можно разбить на модули.
- Ollama в этой среде мокается через `scripts/fake-ollama.mjs`; настоящей модели
  на диске нет — финальная приёмка на реальной Ollama остаётся за кадром.
