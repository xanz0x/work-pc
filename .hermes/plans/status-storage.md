# Статус: папка хранения по умолчанию (библиотека / общий диск)

- [done] Изучить план (разделы 1, 7) и текущий код cloud-store/upload/роутов
- [done] lib/cloud-store.ts: чтение/запись `<AI_DIR>/cloud/storage-root.json`, валидация пути (создание папки), запись файлов в корень под исходным именем (коллизии «имя-1.ext»), sha256/relPath в метаданных, чтение старых объектов из data/cloud/objects
- [done] Роут GET/PUT `/ai-api/cloud/storage-root` (admin-only; GET → `{root}`, PUT `{root}` → валидация/создание, `{root: ''}` → отключение)
- [done] components/cloud-section.tsx: блок «Папка хранения» (текущий путь, изменить, «Открыть папку» через window.workspacexDesktop?.revealInExplorer с честным flash, если моста нет; «Отключить»), статусы анализа после загрузки (POST /ai-api/analyze {objectId}, поллинг GET ~90 сек, спиннер «Анализ…», title/description, «Переанализировать»)
- [done] components/cloud-section.css: стили .cloud-storage и .cloud-uploads (+ узкие экраны)
- [done] Тесты: tests/unit/cloud-storage.test.ts — 4 теста (валидация пути/создание/очистка; запись под исходным именем + коллизии + sha256/relPath + driveView; чтение из корня; легаси-объекты data/cloud/objects читаются при выключенной и включённой папке)

## Верификация
- `node_modules/.bin/tsc --noEmit` — чисто (exit 0).
- `vitest run tests/unit/cloud-storage.test.ts` — 4/4 зелёные.
- `vitest run tests/unit` — 277/279 зелёные; 2 падения ПРЕДСЕСТВУЮЩИЕ и вне моей зоны: `tests/unit/indexer.test.ts` («PDF без зависимостей» — mojibake UTF-8 в lib/indexer/pdf.ts, файл не менялся с 2026-09-06, индексатор мои правки не импортирует).

## Примечания для координатора
- Роута `/ai-api/analyze` ещё нет (зона другого исполнителя): UI вызывает его по контракту и честно показывает «Анализ недоступен (ошибка …)», пока роут не появится. Контракт соблюдён: POST {objectId} → 202 {status:'queued'}, GET ?objectId= → {status, title, description, error}.
- Мост `window.workspacexDesktop` ещё не подключён — вызов `revealInExplorer` через optional chaining с проверкой `typeof === 'function'`.
- Выбор папки — через window.prompt (как «Новая папка» в этом же разделе); нативный диалог появится вместе с мостом, если понадобится.
- Секреты и содержимое файлов в логи не пишутся: withRoute логирует только route/method/status/ms.
