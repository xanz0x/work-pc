# Тестовые реквизиты (актуально: 2026-06, сессия «локальная папка ≠ общая»)

- Превью: https://effd40ac-4830-45ed-9842-822577e8d6bb.preview.emergentagent.com
- Вход: логин `admin`, пароль `IceKrymTeam13@` (источник `/app/.env.local` → APP_PASSWORD, ADMIN_LOGIN=admin)
- `/app/.env.local` восстановлен после сброса пода: APP_SESSION_SECRET и MAIL_SECRET сгенерированы заново,
  `AI_DIR=/app/ai` (каталог `/app/.data` в этом поде отсутствует), `CLOUD_STORAGE=local`.
  Ключи внешних сервисов (SONJJ, OpenRouter) в окружении отсутствуют — почта и модель не подключены.
- Папка хранения после тестов сброшена (`/app/ai/cloud/storage-root.json` удалён), `drive.json` без файлов.
- Фронтенд — прод-сборка: после правок `cd /app && npx next build && sudo supervisorctl restart frontend`.

---

# Тестовые реквизиты (актуально: 2026-06, сессия «фикс сборки + E2E»)

- Превью: https://folder-picker-ui-fix.preview.emergentagent.com
- Вход: логин `admin`, пароль `<APP_PASSWORD>` (источник `/app/.env.local`: APP_PASSWORD, ADMIN_LOGIN)
- `/app/.env.local` восстановлен после сброса пода: APP_SESSION_SECRET и MAIL_SECRET сгенерированы заново
  (прежних в окружении не было). Ключи внешних сервисов (SONJJ и др.) отсутствуют и не выдумывались.
- Модель: OpenRouter, ключ пользователя, модель `z-ai/glm-5.3-flash`; конфиг `/app/.data/ai/provider.json`
  (ключ в документах не дублируем). Emergent LLM key в проекте не используется.
- Фронтенд — прод-сборка: после правок `cd /app && pnpm run build && sudo supervisorctl restart frontend`.
- Постоянных тестовых аккаунтов не создавалось; загруженные при проверке файлы и папка хранения удалены.

---

# Тестовые реквизиты (2026-09-06, чат и навыки)

## Текущий проход Windows-установщика
- Для повторной проверки включён отдельный чистый preview AI_DIR=/app/desktop/.runtime/preview-data, CLOUD_STORAGE=local, admin с теми же тестовыми реквизитами ниже. Старые /app/.data и /app/ai сохранены; данные в них не мигрируются и не стираются.
- Актуальный адрес из supervisor: https://folder-picker-ui-fix.preview.emergentagent.com
- Существующие admin / <APP_PASSWORD> сохранены. Восстановлен локальный файл окружения; служебный ключ cookie создан заново, поскольку исходный отсутствовал. Почтовый ключ не заменялся: прежние данные не трогать.
- Desktop создаёт отдельное чистое хранилище в профиле Windows. Постоянных desktop-аккаунтов пока не создано: владелец задаёт пароль сам в мастере. В installer никакие тестовые пароли/ключи не включать.

## Проверка логотипа — 2026-09-06
- Используется прежняя учётная запись admin ниже; серверные пароли и ключи не менялись.
- `tests/e2e/54-branding-desktop.spec.ts`: одноразовый мастер-пароль `Brand54-LocalOnly!` создаётся исключительно в новом изолированном браузерном контексте; после теста контекст удаляется. Это не пароль аккаунта или пользовательского сейфа.
- Текущий внешний адрес взят из действующего `APP_URL` в `.env.local`/supervisor; `REACT_APP_BACKEND_URL` отсутствует в этом Next.js-окружении.

## Текущий проход чата
- Превью: https://folder-picker-ui-fix.preview.emergentagent.com
- Существующий admin / <APP_PASSWORD> сохранён; восстановлена .env.local и служебный ключ cookie.
- Claude Sonnet 4.5: прежний TypeScript-адаптер, конфигурация универсального ключа восстановлена через менеджер интеграций. Реальная генерация пароля, сохранение секрета и следующий ход после отмены проверены успешно.
- 2026-06: `SONJJ_API_KEY` (внешний платный SmailPro) задан пользователем, `MAIL_SECRET` сгенерирован заново (прежнего в окружении не было). Оба в `/app/.env.local`, значения не дублировать в документах. Реальная выдача Gmail и бесплатного mail.tm проверена.
- После изменений production Next требует `yarn next build && supervisorctl restart frontend`.
- Запуск тестов на внешнем APP_URL; старые сведения ниже об отсутствии всех ключей относятся к задаче карты.

## Вход в приложение
- Логин: `admin`
- Пароль: `<APP_PASSWORD>`
- Источник: `/app/.env.local` → `APP_PASSWORD`, `ADMIN_LOGIN=admin`

## Запуск e2e
```
cd /app && APP_URL=http://localhost:3000 APP_PASSWORD='<APP_PASSWORD>' ADMIN_LOGIN=admin npx playwright test tests/e2e/<spec>
```

## Прочее
- Мастер-ключ и пароли бэкапов создаются самими спеками (одноразовые), постоянных значений нет.
- Внешний URL превью этого запуска (supervisor APP_URL): https://folder-picker-ui-fix.preview.emergentagent.com
- В задаче карты логин/пароль не менялись; использованы существующие реквизиты. Онбординг пропускается только в изолированном браузерном профиле теста через `tests/e2e/onboard.ts`.
- После восстановления окружения .env.local содержит прежние admin/пароль, новый служебный ключ cookie и AI_DIR=/app/.data. Ключи внешних сервисов отсутствуют; не заменялись выдуманными.
- Фронтенд — продакшн-сборка под supervisor (`next start`), после правок нужен `npx next build && sudo supervisorctl restart frontend`.
