# С чего продолжать (обновлено: 2026-06, сессия «подпапки + меню письма»)

## Состояние: обе задачи из `docs/tasks/NEXT-CHAT-INSTRUCTIONS.md` закрыты и проверены

| Задача | Код | Проверка |
|---|---|---|
| Локальная папка = личная, без авто-дубля | ✅ | E2E 60/62 — `shared:false`, одна карточка |
| Новый folder picker (дерево + содержимое) | ✅ | было в iter59 |
| Подпапки локального хранилища (реальные папки + UI) | ✅ | E2E 60/62: `<root>/A/B/файл`, полоса папок, крошки |
| Контекстное меню внутри письма | ✅ | E2E 61/62: CTA, текст, выделение, картинка, закрытие |
| vitest `desktop-config` / `desktop-security` | ✅ | зелёные после `pnpm install --prod` в `/app/desktop` |

Регресс: `npx vitest run` 327/327, `next build` EXIT=0, `tsc --noEmit` чисто, eslint 0 ошибок.
Независимый отчёт: `test_reports/iteration_60.json` — 100%, багов нет.

## Как запускать
```bash
cd /app && pnpm install && (cd desktop && pnpm install --prod --ignore-scripts)
npx next build && sudo supervisorctl restart frontend      # прод-сборка под supervisor
APP_URL=http://localhost:3000 APP_PASSWORD='<из .env.local>' ADMIN_LOGIN=admin \
  npx playwright test tests/e2e/60-local-subdirs.spec.ts tests/e2e/61-mail-ctx-menu.spec.ts tests/e2e/62-independent-verification.spec.ts
```
Спеки самодостаточны: сами задают папку хранения, сами заводят ящик mail.tm, сами доставляют
письмо (`scripts/qa-send-rich-mail.py`, прямой SMTP на in.mail.tm:25) и убирают всё за собой.

## Что важно знать
- `/app/.env.local` пересоздан: `APP_SESSION_SECRET` и `MAIL_SECRET` НОВЫЕ. Прежние временные
  ящики после смены `MAIL_SECRET` не читаются — их надо удалять и создавать заново.
- Ключей внешних сервисов нет: модель не подключена (ИИ-разбор файла отвечает «модель не
  подключена» — это не баг), SmailPro/Gmail недоступны, mail.tm работает без ключей.
- Из sandbox-iframe письма cookie сессии НЕ уходит (opaque origin ⇒ кросс-сайт), поэтому любые
  наши серверные ресурсы внутри письма надо готовить на странице и подставлять как `data:`.
- Папка хранения сейчас НЕ выбрана (`ai/cloud/storage-root.json` отсутствует), диск пуст.

## Бэклог (по приоритету)
1. P1 — разбить `components/screen-library.tsx` (3000+ строк).
2. P1 — `data:`-картинки и для обычных ящиков (`components/mail/mail-msg-view.tsx`).
3. P2 — переименование/удаление подпапок из полосы папок Библиотеки.
4. P2 — `/ai-api/ai/provider/models` без обёртки `{ok:true}`.
5. P3 — eslint: 123 предупреждения (в основном `react-hooks/refs` в сторах и тестах).
