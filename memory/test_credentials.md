# Тестовые доступы · WorkfloW

## Вход в приложение (P0-2, волна 1)
- Страница входа: `/login`
- Пароль приложения: `IceKrymTeam13@`
- Переменная окружения: `APP_PASSWORD` в `/app/.env`
- Cookie сессии: `wf_session` (httpOnly, 12 часов), выдаётся `POST /ai-api/auth/login`
- Проверка сессии: `GET /ai-api/auth/session`, выход: `DELETE /ai-api/auth/session`
- Без cookie любой маршрут `/ai-api/*` отвечает 401 `{"code":"AUTH_REQUIRED"}`

## Лимиты
- `/ai-api/chat`: 10 ходов в минуту и 200 в сутки с одного IP → 429 `{"code":"RATE_LIMITED"}`
- `/ai-api/auth/login`: 10 попыток на 15 минут с IP → 429

## Мастер-ключ сейфа
Замок пользовательский: если он включён в браузере, пароль знает только владелец.
В чистом профиле замок выключен, никакого мастер-ключа вводить не нужно.

## Модель
- Облачная модель: `claude-sonnet-4-5-20250929` (`AI_MODEL`), подпись в UI — `NEXT_PUBLIC_AI_MODEL_LABEL`
- Ключ шлюза: `EMERGENT_LLM_KEY` в `/app/.env`
