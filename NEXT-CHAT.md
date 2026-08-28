# ИНСТРУКЦИЯ ДЛЯ СЛЕДУЮЩЕГО ЧАТА · WorkfloW / Менеджер секретов

> Прочитай этот файл ПЕРВЫМ. Затем: `/app/HANDOFF-VAULT.md` (построчная история модуля)
> и `/app/memory/PRD.md` (что сделано по датам). Тест-репорты: `/app/test_reports/iteration_1..4.json`.

---

## 1. Как запустить (среда ломается, если сделать иначе)

```bash
cd /app
npm i -g pnpm@10          # pnpm 9 НЕ работает: в pnpm-workspace.yaml поле minimumReleaseAge (нужен pnpm 10)
pnpm install              # node_modules пропадают после рестарта пода — ставить каждый раз
npx tsc --noEmit          # главный гейт, должен быть 0 ошибок
npx next build && nohup npx next start -p 3000 -H 0.0.0.0 > /tmp/next-start.log 2>&1 &
```

- **НЕ запускать `next dev`** — Next 16 режет чанки cross-origin проверкой на preview-URL.
- **НЕ трогать supervisor** — его конфиг (backend:8001 + yarn frontend) не подходит этому проекту,
  backend в проекте отсутствует по задумке (всё в localStorage браузера).
- **Роуты-хендлеры класть ТОЛЬКО вне `/api/*`** — K8s ingress preview уводит `/api/*` на
  несуществующий backend:8001. Рабочий пример: `app/proxy/favicon/route.ts` → путь `/proxy/favicon`.
- Мастер-ключ для тестов: метод «Пароль», значение `test-master-1234`
  (Менеджер секретов → «Настроить мастер-ключ» → вкладка «Пароль» → 2× ввод → сохранить).
  Данные в localStorage: чистый профиль браузера = пустой сейф, создавать заново.

## 2. Статус: ВСЕ задания из прошлого чата ВЫПОЛНЕНЫ и приняты тест-агентом

- ✅ 6 дизайн-правок (кластеры → выпадашка Библиотеки; удаление папок; тумблеры генератора;
  редизайн редактора; иконки 12 типов + favicon; таймеры reveal/буфера) — iteration_2, 100%.
- ✅ Favicon по умолчанию через `/proxy/favicon` + 4 фичи: Password Health, BIP39 12/24 с чексуммой,
  Password History с откатом, Expiry Reminders 30/7/1 — iteration_3 (favicon доведён после отчёта).
- ✅ 3 бага: папки удаляются (красная «Удалить?»), кластеры сразу под Библиотекой,
  компактный редактор с кастомными дропдаунами VtSelect — iteration_4, 100%.

## 3. Что осталось ДОДЕЛАТЬ (в порядке приоритета)

### P0 — единственный незакрытый хвост
1. **Живая проверка ленивой миграции KDF 310k → 600k.** Код готов (`lib/lock-migrate.ts`,
   ядро `rewrapAll` проверено через смену мастер-ключа), но legacy-замок 310k живьём не
   воспроизводился. Сценарий: временно собрать замок с `iterations: 310000`, создать ключ на
   файл + секрет, вернуть актуальную сборку, войти → должно быть уведомление о миграции,
   файл и секрет открываются, создан бэкап `wf.lock.migrate.backup.<ts>`.

### P1 — следующие фичи (пользователь их уже видел в предложениях)
2. **Wi-Fi QR**: в детали записи типа Wi-Fi кнопка «QR» → QR-код `WIFI:T:WPA;S:<ssid>;P:<pass>;;`.
   Zero-dependency: QR-генератор написать самим (или canvas-реализация) — НЕ добавлять npm-пакеты.
3. **Generator Hub**: в генератор добавить режимы «Passphrase» (слова из BIP39-словаря
   `lib/bip39-words.ts` + разделитель + число) и «Username» (произносимые пары слогов).
4. **Expiring View**: вид «Истекающие» в левой колонке сейфа (по образцу «Здоровье паролей»
   в `components/vault/vault-health.tsx`): сортировка по сроку, бейджи 30/7/1/EXPIRED.
5. **Attachments**: маленькие файлы к записи (тип `Attachment` уже есть в `lib/secrets.ts`:
   `{id,name,size,ct,iv}`) — шифровать содержимое AES-GCM ключом записи (см. `sealField`
   в `lib/secrets-store.tsx`), лимит ~256 КБ, скачивание через расшифровку в Blob.

### P2 — по желанию
6. Drag&drop записей в папки; переименование папок из UI (store-метод `renameFolder` уже есть).
7. Виртуализация списка при 1000+ записей.
8. Отдельный аудит-журнал модуля секретов (сейчас пишем в общую ленту уведомлений).
Вырезано осознанно (НЕ делать без запроса): duress vault, WebAuthn, .kdbx, HIBP, team/shared, autofill.

## 4. Правила проекта (нарушение = переделка)

- **Zero-dependency**: ни одной новой npm-зависимости. Всё пишется руками (пример: `lib/bip39.ts`).
- Стиль «Графит»: тёмный, моноширинные подписи `label-mono`, акцент зелёный `var(--accent)`,
  активные состояния через `.on` (бордер `--accent-line` + фон `--panel-2`). CSS дописывать
  В КОНЕЦ `app/globals.css` новым слоем-комментарием `VAULT v1.4 …`, ничего не переписывать.
- Секреты: plaintext живёт только в памяти на время операции; в DOM никаких внешних src;
  наружу уходит максимум домен (favicon). ИИ-чат к секретам доступа не имеет (`excludeFromAi`).
- Каждый интерактивный элемент — `data-testid` (kebab-case).
- В редакторе селекты КАСТОМНЫЕ (`components/vault/vt-select.tsx`): в тестах `select_option`
  не работает — кликать кнопку, потом опцию `<testId>-opt-<value>`.
- После правок: `npx tsc --noEmit` = 0 → rebuild → приёмка testing-агентом (обязательна для багов).

## 5. Карта ключевых файлов

| Файл | Что внутри |
|---|---|
| `components/screen-vault.tsx` | 3-колоночный экран, роутинг видов (view.kind: all/fav/health/type/folder/trash) |
| `components/vault/vault-nav.tsx` | левая колонка: поиск, виды, типы, папки (+удаление), корзина |
| `components/vault/vault-list.tsx` | центр: карточки, favicon/иконки типов |
| `components/vault/vault-detail.tsx` | правая колонка: поля, TOTP, история изменений (HistoryRow) |
| `components/vault/vault-editor.tsx` | редактор: сетка типов, VtSelect, поля-строки, дата ДД.ММ.ГГГГ |
| `components/vault/vault-generator.tsx` | генератор: пароль/Seed BIP39/PIN/hex/UUID |
| `components/vault/vault-health.tsx` | аудит паролей (образец для новых видов) |
| `lib/secrets-store.tsx` | ВЕСЬ стейт: CRUD, крипто-обёртки, буфер, бэкапы, expiry-напоминания, favicon |
| `lib/secrets.ts` | типы, TYPE_META/TYPE_HUE, настройки, parseRuDate |
| `lib/secrets-crypto.ts` | SEK→HKDF→AES-GCM (`sealField`/`openField`) — НЕ трогать без нужды |
| `lib/bip39.ts` + `lib/bip39-words.ts` | BIP39 (сверен с офиц. векторами) |
| `app/proxy/favicon/route.ts` | единственный серверный роут |

## 6. Чем закончить любой сеанс

1. `npx tsc --noEmit` = 0, production-сборка поднята на :3000.
2. Приёмка testing-агентом (для багфиксов — обязательна).
3. Обновить `/app/memory/PRD.md`, этот файл и `/app/HANDOFF-VAULT.md`.
