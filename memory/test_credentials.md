# Тестовые реквизиты (актуально: итерация 67 «удаление с ПК + ПКМ у курсора + код/ссылка письма»)

- Вход: логин `admin`, пароль `WsxQa2026!lib` (`ADMIN_LOGIN`/`APP_PASSWORD` в `/app/.env.local`).
- Превью: https://library-storage-sync.preview.emergentagent.com (локально http://localhost:3000)
- Под сбрасывали: заново `pnpm install` в `/app`, `pnpm install --prod --ignore-scripts`
  в `/app/desktop`, пересоздан `/app/.env.local` (**новые** `APP_SESSION_SECRET`, `MAIL_SECRET`,
  `AI_DIR=/app/.data`, `CLOUD_STORAGE=local`). Затем `node_modules/.bin/next build` и
  `sudo supervisorctl restart frontend` — БЕЗ сборки превью показывает старый бандл.
- Папка хранения: `/root/wsx-store` (задана через `PUT /ai-api/cloud/storage-root`).
- Временный ящик mail.tm для проверок: `330947478dd9@uberip.com`, id `5945287b`.
  Письма: `6aa36280a5387287a78baf87` (QA1, без кода, с кнопкой), `6aa36281a379a1cefe8f0c92`
  (QA2, код 483920 + кнопка), `6aa3628292c70f029943b33a` (QA3, ни кода, ни кнопки).
- Новые письма можно доставить по-настоящему: `python3 scripts/qa-send-mail.py <адрес@uberip.com>`
  (прямое SMTP на `in.mail.tm:25`, порт из пода открыт).
- Онбординг пропускается через localStorage `wf.settings.v1` →
  `onboarding: {at:1700000000000, mode:'hybrid', keyChoice:'declined', start:'demo'}`.
- Масштаб интерфейса для проверки ПКМ: localStorage `wf.ui.scale` = `125`.
- `SONJJ_API_KEY` отсутствует → ящики Gmail/Outlook во «Временных» создать нельзя.

---


# Тестовые реквизиты (актуально: итерация 66 «пустой ответ ИИ в exe + полоса приёма файлов»)

- Вход: логин `admin`, пароль `WsxQa2026!lib` (`ADMIN_LOGIN`/`APP_PASSWORD` в `/app/.env.local`).
  Поля: `data-testid=login-login`, `data-testid=login-password`.
- Превью: https://library-storage-sync.preview.emergentagent.com (локально http://localhost:3000)
- Под сбрасывали: заново `corepack enable && pnpm install` в `/app`,
  `pnpm install --prod --ignore-scripts` в `/app/desktop`, пересоздан `/app/.env.local`
  (**новые** `APP_SESSION_SECRET` и `MAIL_SECRET`, `AI_DIR=/app/.data`, `CLOUD_STORAGE=local`).
  Затем `node_modules/.bin/next build && sudo supervisorctl restart frontend`.
- Модель подключена ключом пользователя: OpenRouter, `z-ai/glm-5.3-flash`
  (файл `/app/.data/ai/provider.json`, ключ шифруется `APP_SESSION_SECRET`). Ключ в отчётах не печатать.
- Папка хранения для проверок: `/root/wsx-store` (`PUT /ai-api/cloud/storage-root`).
- Онбординг пропускается через localStorage `wf.settings.v1` →
  `onboarding: {at:1700000000000, mode:'hybrid', keyChoice:'declined', start:'demo'}` + перезагрузка.
- `SONJJ_API_KEY` (Gmail-ящики SmailPro) по-прежнему отсутствует.

---

# Тестовые реквизиты (актуально: сессия «выделение в почте + одно меню в инспекторе»)

- **Под снова сбрасывали**: пропали `node_modules` и `/app/.env.local`, фронтенд был `FATAL`.
  Восстановлено: `corepack enable && pnpm install` в `/app` и `pnpm install --prod --ignore-scripts`
  в `/app/desktop`, заново создан `/app/.env.local` (**новые** `APP_SESSION_SECRET` и `MAIL_SECRET`),
  затем `node_modules/.bin/next build` и `sudo supervisorctl restart frontend`.
- **`SONJJ_API_KEY` (SmailPro / Gmail-ящики) потерян вместе с `.env.local`** — пользователь сказал,
  что токена нет. Gmail-ящики во «Временных» создать нельзя, проверять почту нужно на mail.tm.
- Прежний временный ящик `c1813a12de3f@uberip.com` стал нечитаем (другой `MAIL_SECRET`) и удалён.
  Для проверок оставлен рабочий ящик `2034af68977e@uberip.com` (id `c7c4cbd2`) с двумя QA-письмами.
- Онбординг в чистом профиле браузера быстрее пропускать через localStorage:
  `wf.settings.v1` → `onboarding: {at: 1700000000000, mode:'hybrid', keyChoice:'declined', start:'demo'}`
  и перезагрузить страницу.
- Playwright в скриншот-инструменте — **асинхронный API**: без `await` вызовы молча не выполняются.

---

# Прежние реквизиты (сессия «прокрутка открытого письма»)

- Превью: https://library-storage-sync.preview.emergentagent.com (локально http://localhost:3000)
- Онбординг в чистом профиле: «Дальше · мастер-ключ» → «Продолжить без защиты» → «Да, продолжить без защиты» → «Посмотреть демо».
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
