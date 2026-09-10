# Тестовые реквизиты (актуально: сессия «прокрутка открытого письма»)

- Превью: https://bb33431c-b483-49a3-9a1a-4eb300fe5e7c.preview.emergentagent.com (локально http://localhost:3000)
- Вход: логин `admin`, пароль `WsxQa2026!lib` (значение лежит в `/app/.env.local` → `APP_PASSWORD`, `ADMIN_LOGIN=admin`).
  Поля входа: `data-testid=login-login`, `data-testid=login-password`.
- `/app/.env.local` восстановлен после сброса пода: `APP_SESSION_SECRET` и `MAIL_SECRET` **новые**,
  `AI_DIR=/app/ai`, `CLOUD_STORAGE=local`. Перед восстановлением `ai/mail/temp.json` был пуст.
- Пользовательский токен SmailPro сохранён только в `.env.local` как `SONJJ_API_KEY`; не печатать его в отчётах.
- Ключей внешних ИИ-сервисов нет: модель не подключена, ИИ-разбор файла отвечает
  «модель не подключена» — это ожидаемо и не баг.
- Временная почта mail.tm работает без ключей; тестовое письмо с кнопкой, текстом и картинкой:
  `python3 scripts/qa-send-rich-mail.py <адрес>`.
- Реального IMAP-ящика в среде НЕТ — конвейер картинок для обычных ящиков проверен кодом,
  unit-тестами (`tests/unit/mail-img.test.ts`) и временной почтой.
- Зависимости: `pnpm install` в корне и `pnpm install --prod --ignore-scripts` в `/app/desktop`.
  Playwright-браузеры не установлены: `npx playwright install chromium` перед e2e.
- E2E: `cd /app && APP_URL=http://localhost:3000 APP_PASSWORD='WsxQa2026!lib' ADMIN_LOGIN=admin npx playwright test tests/e2e/<spec>`
- Фронтенд — прод-сборка: `cd /app && npx next build && sudo supervisorctl restart frontend`.
- Постоянных тестовых аккаунтов не создаётся; тестовые файлы, подпапки и ящики удаляются после проверок.

---

# История (предыдущие сессии)

- Логин администратора не менялся между сессиями: `admin` / `APP_PASSWORD` из `.env.local`.
- Одноразовые мастер-пароли и ключи создаются самими спеками в изолированных браузерных профилях.
- Онбординг пропускается в тестовом профиле через `tests/e2e/onboard.ts`.
