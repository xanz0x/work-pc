# Тесты

## `api/test_ai_api.py`

Интеграционные тесты серверных маршрутов Next.js (`/ai-api/skills`, `/ai-api/mcp`,
`/ai-api/system`, `/ai-api/sessions`, SSE-поток `/ai-api/chat` с циклом скиллов).

```bash
pip install pytest requests
APP_URL=http://localhost:3000 python3 -m pytest tests/api -q
```

`APP_URL` — адрес запущенного приложения (по умолчанию `http://localhost:3000`),
`AI_DIR` — каталог файлового слоя ИИ (по умолчанию `/app/ai`).

Тесты пишут и удаляют собственные скиллы и сессии, но проверяют и встроенные:
запускать против рабочего сейфа с ценными диалогами не стоит.

## Чего пока нет

Unit-тестов крипто-ядра, модели уведомлений и redact-слоя, а также E2E — это
пункт **P0-4** из аудита (`docs/audit/`).
