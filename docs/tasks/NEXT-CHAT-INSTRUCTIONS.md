# Инструкция для следующего чата — как довести все задачи до конца

> **СТАТУС 2026-06: ВСЁ ВЫПОЛНЕНО.** Все шаги 0–5 пройдены, обе задачи (подпапки и меню
> внутри письма) закрыты и проверены E2E (`tests/e2e/60`, `61`, `62`), тестовые данные убраны,
> vitest 327/327. Итог — в `memory/PRD.md` (последний раздел), `memory/NEXT_SESSION.md`,
> `memory/HANDOFF_NEXT_CHAT.md`, отчёт — `test_reports/iteration_60.json`.
> Текст ниже оставлен как история задачи.

> Проект: **WorkSpaceX** (Next.js из корня `/app`). Реальное приложение стартует как root Next.js app, `sudo supervisorctl restart frontend` при необходимости. Собственные dev-серверы не запускать.
> Перед стартом прочитать: `/app/memory/PRD.md`, `/app/memory/NEXT_SESSION.md`, `/app/memory/HANDOFF_NEXT_CHAT.md`, `/app/memory/test_credentials.md`, последний `/app/test_reports/iteration_*.json`.

---

## Статус на момент паузы

| Задача | Код | Проверка |
|---|---|---|
| 1. Локальная папка = личная, не общая | ✅ написан | agent-tested, НЕ подтверждён пользователем |
| 2. Нет авто-дубля в общий диск | ✅ написан | agent-tested (Iter59) |
| 3. Новый UI folder picker (дерево + содержимое) | ✅ написан | agent-tested (Iter59) |
| 4. Контекстное меню в письме (bridge/postMessage) | ✅ написан (`mail-frame-bridge.ts`) | CTA/ссылка работают в headless; текст и картинка — НЕ подтверждены |
| 5. Подпапки в локальном хранилище (реальные папки + UI) | 🟡 в процессе, build EXIT=0 | НЕ протестировано E2E |

**Главное: ничего не подтверждено пользователем и последний прогон testing agent после подпапок + нового mail bridge НЕ выполнялся. `finish` не вызывался.**

---

## Что нужно сделать по шагам

### Шаг 0. Инспекция текущего кода (обязательно первым)
Работа была на середине. Просмотреть diff/код:
- `components/intake-dir-dialog.tsx` (новый)
- `components/library-dirs.css` (новый)
- `components/mail/mail-frame-bridge.ts` (новый)
- изменённые области `components/screen-library.tsx`
- `lib/cloud-store.ts` (передача `f.dir` в `writeIntoRoot`, `createFolder` с `fs.mkdir(..., {recursive:true})`)
- `components/mail/mail-msg-view.tsx`, `components/mail/mail-temp-pane.tsx`

Убедиться, что build чистый:
```bash
cd /app && npx next build   # ожидаем EXIT=0
sudo supervisorctl restart frontend   # затем ожидаем 200
```
⚠️ Turbopack ранее ругался `Dynamic filesystem access ... tracing` в `lib/cloud-store.ts` — не сломать path-логику при правках.

---

### Шаг 1. Задача «Подпапки» — довести и протестировать E2E
Требование пользователя: при добавлении файла выбирать/создавать **реальную** подпапку внутри выбранной локальной корневой папки; в Библиотеке — верхняя полоса папок + breadcrumbs.

Проверка:
1. Установить временный storage root в безопасный путь, напр. `/tmp/wsx-local`.
2. Через UI открыть add-file flow → создать/выбрать подпапку → добавить файл.
3. FS/API-проверкой подтвердить путь `<root>/<subdir>/<file>`.
4. В Библиотеке проверить: folder strip сверху, breadcrumbs, фильтрацию по каталогу и возврат назад.
5. Подтвердить, что файл в подпапке `shared:false` и НЕ появился в общем диске и не задублировался.
6. Убедиться, что все новые интерактивные элементы имеют уникальные `data-testid` (kebab-case).
7. Удалить тестовый файл/каталог, сбросить storage root.

---

### Шаг 2. Задача «Контекстное меню в письме» — довести
CTA/ссылка уже открывают `[data-testid=mail-ctx-menu]` в headless при корректных координатах.
Осталось:
1. Один browser context: создать/выбрать temp mailbox (mail.tm, без токена), открыть тестовое письмо.
2. Right-click отдельно по: **кнопке/CTA**, **обычному/выделенному тексту**, **картинке**.
3. Для каждого проверить появление `[data-testid=mail-ctx-menu]` и корректные пункты меню + действия.
4. Использовать абсолютные bounding boxes iframe (не голый `mouse.click(button='right')` по вычисленным координатам).
5. Image proxy `/ai-api/mail/img` уже даёт `200 image/jpeg` — использовать в image-тесте.

⚠️ Ловушки:
- Временный ящик из предыдущего browser context НЕ переносится — открывать/выбирать его в том же контексте.
- mail.tm ключи не нужны.

---

### Шаг 3. Testing agent
После targeted-проверок вызвать `testing_agent` с полным контекстом именно для:
- **подпапок** (создание физической папки, запись файла, folder strip + breadcrumbs, отсутствие дубля/публикации);
- **mail iframe контекстного меню** (CTA / текст / картинка).
Прочитать новый `/app/test_reports/iteration_*.json`, исправить ВСЕ баги (включая low priority), перетестировать.

---

### Шаг 4. Очистка тестовых данных
- Удалить тестовые файлы из `/tmp`.
- Сбросить временный storage root.
- Удалить тестовый temp mailbox mail.tm (проверить список/через API), не оставлять тестовые данные.
- Не трогать пользовательские данные в `/app/.data` и `/app/ai` вне строго нужных тестовых операций.

---

### Шаг 5. Обновить память и finish
- Обновить: `memory/PRD.md`, `memory/NEXT_SESSION.md`, `memory/HANDOFF_NEXT_CHAT.md`.
- Если менялись реквизиты/ящики — `memory/test_credentials.md`.
- Вызвать `finish` с кратким итогом + Next Action Items.

---

## Инварианты (не нарушать)
- Локальная корневая папка = ЛИЧНАЯ. Новые локальные файлы НЕЛЬЗЯ снова помечать `shared:true` автоматически.
- Публикация в общий диск — только явное действие пользователя.
- Не запускать собственные серверы; frontend управляется supervisor.
- Build: `cd /app && npx next build`, затем `sudo supervisorctl restart frontend`.
- `/tmp` не durable — чистить после тестов.
- Не рефакторить огромный `components/screen-library.tsx` (>2900 строк) вне прямого запроса.
- Секреты/пароли/токены не публиковать в коде, коммитах, summary. Пароль приложения — из `.env.local` (`APP_PASSWORD`), reference в `memory/test_credentials.md`.

## Известные незакрытые (вне запроса пользователя)
- 2 vitest файла падают: `desktop-config`, `desktop-security` (нет модуля `selfsigned`). Не относится к запросу — трогать только по явной просьбе.
- Lint: 0 errors, ~18 warnings (в т.ч. `react-hooks/refs` в `lib/store/data.tsx`).
