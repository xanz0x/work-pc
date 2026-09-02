# Тестовые доступы · WorkfloW

## Вход в приложение (P0-2, волна 1)
- Страница входа: `/login`
- Пароль приложения: `IceKrymTeam13@`
- Переменная окружения: `APP_PASSWORD` в `/app/.env`
- `/app/.env` восстановлен 2026-09-02 (файл пропадал вместе с pod'ом): помимо
  `APP_PASSWORD` в нём `APP_SESSION_SECRET` (локальный dev-ключ подписи cookie,
  меняется свободно — старые сессии просто перестанут проходить) и
  `APP_SESSION_TTL_HOURS=12`. Без этих переменных прод-сервер не поднимается
- Cookie сессии: `wf_session` (httpOnly, 12 часов), выдаётся `POST /ai-api/auth/login`
- Проверка сессии: `GET /ai-api/auth/session`, выход: `DELETE /ai-api/auth/session`
- Без cookie любой маршрут `/ai-api/*` отвечает 401 `{"code":"AUTH_REQUIRED"}`,
  кроме `POST /ai-api/auth/login` и `POST /ai-api/telemetry` (приём клиентской
  ошибки открыт, чтобы падение на экране входа доходило до трекера)

## Лимиты
- `/ai-api/chat`: 10 ходов в минуту и 200 в сутки с одного IP → 429 `{"code":"RATE_LIMITED"}`.
  Битые тела (400) бюджет не тратят — считается только разобранный запрос
- `/ai-api/auth/login`: 10 попыток на 15 минут с IP → 429
- `POST /ai-api/telemetry`: 30 записей на 5 минут с IP → 429
- В тестах лимит обходится своим адресом: заголовок `X-Forwarded-For`

## Мастер-ключ сейфа
Замок пользовательский: если он включён в браузере, пароль знает только владелец.
В чистом профиле замок выключен, никакого мастер-ключа вводить не нужно.

E2E-сценарии (`tests/e2e/`) создают замок в чистом профиле браузера с паролем
`e2e-master-2026`. К данным разработчика он отношения не имеет: профиль Playwright
одноразовый.

## Первый запуск (NF-4)
- Новый профиль браузера начинает с онбординга из трёх шагов; он перекрывает
  интерфейс, пока не пройден.
- В e2e он гасится хелпером `skipOnboarding(page)` (`tests/e2e/onboard.ts`):
  в `localStorage` пишется `wf.settings.v1.onboarding.at`.
- Сценарий `tests/e2e/11-onboarding.spec.ts` проходит шаги честно и создаёт PIN
  `123456` в одноразовом профиле Playwright.

## Модель
- Облачная модель: `claude-sonnet-4-5-20250929` (`AI_MODEL`), подпись в UI — `NEXT_PUBLIC_AI_MODEL_LABEL`
- Шлюз: `AI_PROXY_URL=https://integrations.emergentagent.com/llm`
  (OpenAI-совместимый, вызывается `${AI_PROXY_URL}/chat/completions`)
- Ключ шлюза: `EMERGENT_LLM_KEY` в `/app/.env` (универсальный ключ Emergent)
- Движок в интерфейсе выбирается в «Настройках» и вступает в силу только после
  кнопки «Сохранить» (`data-testid="settings-save"`)

## Конфигурация (AR-5, волна 2)
- Полный список переменных с комментариями: `/app/.env.example`
- Сервер не стартует при неполной конфигурации: `instrumentation.ts` → `lib/env.ts`
- `/app/.env` и `/app/.env.example` не хранятся в git (оба под `.gitignore`):
  после сброса пода восстанавливать по этому файлу. Обязательны `APP_PASSWORD`
  и `APP_SESSION_SECRET` (32+ символа, например `openssl rand -hex 32`).
  Смена секрета инвалидирует прежние cookie — это ожидаемо
- Метрики и последние ошибки: `GET /ai-api/telemetry` (нужна cookie сессии).
  Живут в памяти процесса: перезапуск фронтенда обнуляет их, поле `since`
  показывает начало отсчёта
- `AI_DIR=/root/.workflow/ai` засевается при старте из репозитория (`ai/`):
  существующие файлы не перезаписываются

## Как прогнать всё локально
```bash
cd /app
npx tsc --noEmit
npx eslint .
npx vitest run
python3 -m pytest tests/api -q
PLAYWRIGHT_BROWSERS_PATH=/pw-browsers APP_URL=http://localhost:3000 \
  APP_PASSWORD=IceKrymTeam13@ npx playwright test
APP_URL=http://localhost:3000 APP_PASSWORD=IceKrymTeam13@ node scripts/long-dialog.mjs
```
Новые сценарии e2e (сессия 3): `09-file-key.spec.ts` (файловый ключ, пароль
файла `e2e-file-pass-2026`), `10-first-frame-write.spec.ts` (архив из 20 файлов),
второй тест в `06-storage-migration.spec.ts` (вход через `/login`).
Хелпер чтения IndexedDB из тестов — `tests/e2e/idb.ts`.

Браузеры Playwright после сброса пода ставятся заново:
`PLAYWRIGHT_BROWSERS_PATH=/pw-browsers npx playwright install chromium`.
Зависимости — pnpm: `npx -y pnpm@10.11.0 install --frozen-lockfile`.
