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

## 2. Статус: ВСЕ задания прошлого чата ВЫПОЛНЕНЫ и приняты тест-агентом

- iteration_2 (100%): 6 дизайн-правок. iteration_3: favicon + Password Health + BIP39 + история
  паролей + expiry-напоминания. iteration_4 (100%): папки, кластеры, компактный редактор.
- **iteration_5 (100%, замечаний нет) — сессия VAULT v1.5, 4 фичи P1:**
  Wi-Fi QR (свой кодер `lib/qr.ts`, валидирован внешним декодером на v1–10 и кириллице),
  Generator Hub («Фраза» из BIP39-словаря + «Имя» из слогов), вид «Истекающие»
  (`vault-expiring.tsx`, счётчик = просрочено + ≤30 дн), зашифрованные вложения
  (256 КБ на файл, 1 МБ на запись; маркер файла в localStorage отсутствует).

## 3. Что осталось ДОДЕЛАТЬ (в порядке приоритета)

### P0 — единственный незакрытый хвост
1. **Живая проверка ленивой миграции KDF 310k → 600k.** Код готов (`lib/lock-migrate.ts`,
   ядро `rewrapAll` проверено через смену мастер-ключа), но legacy-замок 310k живьём не
   воспроизводился. Сценарий: временно собрать замок с `iterations: 310000`, создать ключ на
   файл + секрет, вернуть актуальную сборку, войти → должно быть уведомление о миграции,
   файл и секрет открываются, создан бэкап `wf.lock.migrate.backup.<ts>`.

### P2 — по желанию
2. Drag&drop записей в папки; переименование папок из UI (store-метод `renameFolder` уже есть).
3. Виртуализация списка при 1000+ записей.
4. Отдельный аудит-журнал модуля секретов (сейчас пишем в общую ленту уведомлений).
Вырезано осознанно (НЕ делать без запроса): duress vault, WebAuthn, .kdbx, HIBP, team/shared, autofill.

## 4. Правила проекта (нарушение = переделка)

- **Zero-dependency**: ни одной новой npm-зависимости. Всё пишется руками (пример: `lib/bip39.ts`).
- Стиль «Графит»: тёмный, моноширинные подписи `label-mono`, акцент зелёный `var(--accent)`,
  активные состояния через `.on` (бордер `--accent-line` + фон `--panel-2`). CSS дописывать
  В КОНЕЦ `app/globals.css` новым слоем-комментарием `VAULT v1.6 …` (последний слой — v1.5), ничего не переписывать.
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
| `components/vault/vault-expiring.tsx` | вид «Истекающие»: группы, бейджи EXPIRED/N дн |
| `components/vault/vault-attachments.tsx` | вложения записи (add/get/del, лимиты из store) |
| `components/vault/wifi-qr.tsx` | модалка Wi-Fi QR (SVG-модули, автозакрытие 45 с) |
| `lib/qr.ts` | собственный кодер QR: RS-коды, маски, v1–10, level M |
| `app/proxy/favicon/route.ts` | единственный серверный роут |

## 6. Чем закончить любой сеанс

1. `npx tsc --noEmit` = 0, production-сборка поднята на :3000.
2. Приёмка testing-агентом (для багфиксов — обязательна).
3. Обновить `/app/memory/PRD.md`, этот файл и `/app/HANDOFF-VAULT.md`.
