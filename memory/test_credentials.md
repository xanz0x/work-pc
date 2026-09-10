# Тестовые реквизиты (актуально: 2026-06, сессия «подпапки + меню письма»)

- Превью (APP_URL из supervisor): https://77e4101c-b4f5-45ca-949e-6345719609e3.preview.emergentagent.com
- Вход: логин `admin`, пароль из `/app/.env.local` → `APP_PASSWORD` (ADMIN_LOGIN=admin).
- `/app/.env.local` восстановлен после сброса пода: `APP_SESSION_SECRET` и `MAIL_SECRET` сгенерированы
  заново (прежних в окружении не было), `AI_DIR=/app/ai`, `CLOUD_STORAGE=local`.
  Из-за нового `MAIL_SECRET` прежний временный ящик стал нечитаемым — удалён, создан новый.
- Ключи внешних сервисов (SONJJ, OpenRouter) отсутствуют: модель не подключена, разбор файла ИИ
  отвечает «модель не подключена» — это ожидаемо и не мешает приёму файлов.
- Временная почта mail.tm (без ключей): ящик создаётся в приложении, тестовое письмо с кнопкой,
  текстом и картинкой доставляется скриптом `python3 scripts/qa-send-rich-mail.py <адрес>`
  (прямое SMTP-соединение с in.mail.tm:25, как в `tests/api/test_mail_temp_delivery.py`).
- E2E: `cd /app && APP_URL=http://localhost:3000 APP_PASSWORD='<APP_PASSWORD>' ADMIN_LOGIN=admin npx playwright test tests/e2e/<spec>`
- Фронтенд — прод-сборка: после правок `cd /app && npx next build && sudo supervisorctl restart frontend`.
- Зависимости ставятся `pnpm install` в корне и `pnpm install --prod` в `/app/desktop`
  (иначе падают vitest `desktop-config` / `desktop-security`).
- Постоянных тестовых аккаунтов не создавалось. Тестовые файлы, подпапки и папка хранения после
  проверок удаляются.

---

# История (предыдущие сессии)

- Логин/пароль администратора не менялись между сессиями: `admin` / `<APP_PASSWORD>` из `.env.local`.
- Одноразовые мастер-пароли и ключи создаются самими спеками в изолированных браузерных
  профилях, постоянных значений нет.
- Онбординг пропускается только в тестовом профиле через `tests/e2e/onboard.ts`.
