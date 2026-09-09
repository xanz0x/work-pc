# Статус · P5 (mail.tm) + P8 (сессия секретов) — 2026-09-09

Репозиторий: `C:\Users\admin-pc\Desktop\HERMES\work-pc-main`.

## P5. mail.tm «не выдал доступ к ящику» — ГОТОВО

Диагноз по коду: адрес и пароль создавались и сохранялись (AES-GCM от MAIL_SECRET), но
`mtToken` валил любую ошибку /token в общий `PROVIDER` «mail.tm не выдал доступ к ящику»:
- первый логин сразу после `POST /accounts` иногда падает с 401 (аккаунт ещё не активирован
  на стороне mail.tm) — ретрая не было;
- 429 (жёсткий лимит 8 QPS) не отличался от прочих ошибок, `retryAfter` терялся;
- при протухшем токене повторный 401 после refresh тоже давал безликий текст.

Что сделано (`lib/temp-mail.ts`):
- `mtToken`: 429 → `RATE_LIMITED` с `retryAfter`; 401/403 → человеческий текст «не принял
  логин и пароль (ошибка N)»; остальное → `PROVIDER` со статусом и пометкой «токен не пришёл».
- `mtCreate`: ретрай логина до 3 попыток с паузами 300/800 мс при 401 после создания;
  429 на `/domains` и `/accounts` → `RATE_LIMITED` с `retryAfter` (без выжигания попыток).
- `mtCall`: повторный 401 после refresh → честный текст «сохранённый пароль не принимается»;
  429 обогащён упоминанием лимита 8 QPS.
- Токен по-прежнему сохраняется в `secretEnc` вместе с паролем; логин строго ДО запроса
  `/messages` (порядок не менялся — проверен).

Тесты (`tests/unit/temp-mail.test.ts`, fixture-ответы api.mail.tm, fetch/userDir/requireUser
подменены): создание с сохранением credentials (проверен расшифрованный secretEnc, view без
утечки secretEnc/accountId), ретрай логина 401×2→успех, вечный 401 → PROVIDER+текст+401 и
ящик не сохраняется, 429 при логине → RATE_LIMITED(retryAfter=9) за одну попытку, чтение
сообщений под `Bearer tok-1`, 429 чтения → RATE_LIMITED(7), протухший токен → перевход и
свежий токен в secretEnc, чужой MAIL_SECRET → NOT_SUPPORTED. Итог: 21 тест файла (13 прежних).

## P8. «Сейф секретов закрыт» при разблокированном сейфе — ГОТОВО

Диагноз: `wipeLockData()` стирает `wf.lock.*`, но НЕ `wf.secrets.sek.v1`; после «удалить
мастер-ключ → создать новый» обёртка SEK оставалась от прежнего мастера,
`ensureSecretsSession()` детерминированно возвращала false (ретраи не помогали),
`ready=false` навсегда → gate «Сейф секретов закрыт» при `status==='unlocked'`. Плюс окно
ретраев 10×120 мс проигрывало гонку с adoptMasterSession после changeMaster.

Что сделано:
- `lib/lock-store.ts`: локальное событие `MASTER_CHANGED_EVENT` (`wf.lock.master-changed`)
  + `notifyMasterChanged()` (postLockSync слышат только чужие вкладки).
- `lib/store/lock.tsx` (только changeMaster/recoverWithKey): `notifyMasterChanged()` после
  `postLockSync('unlock-config-changed')`; в `rewrapAll` передаётся соль нового lock-state.
- `lib/secrets-crypto.ts`: обёртка SEK штампуется солью lock-state; при неудаче расшифровки
  обёртка с чужим/устаревшим штампом признаётся осиротевшей и честно заменяется новой SEK
  (записи старого SEK не раскрываются, модуль остаётся рабочим). Здоровая смена мастера
  идёт через rewrapAll и в эту ветку не попадает.
- `lib/lock-migrate.ts`: `rewrapAll(..., newSaltB64?)` штампует переупакованную обёртку SEK.
- `lib/secrets-store.tsx`: окно попыток 25×120 мс (~3 с) с отменой superseded-циклов;
  при итоговой неудаче — запись в журнал безопасности (`secrets-session`); слушатель
  MASTER_CHANGED_EVENT перезапускает сессию в той же вкладке; новый `retrySession()` в контексте.
- `lib/journal.ts`: вид `secrets-session` (+ иконка в `components/screen-activity.tsx`).
- `components/screen-vault.tsx` (только gate): при `!s.ready` и разблокированном замке —
  честный текст «Замок открыт — дожидаемся ключа…» и кнопка «Проверить ключ снова».

Тесты (`tests/unit/secrets-restart.test.tsx`): крипто-уровень — штамп соли, восстановление
после delete+recreate (раньше false навсегда), здоровый перевход не пересоздаёт SEK;
машина состояний на настоящих провайдерах — setupLock→ready, changeMaster→ready остаётся
true без relock (createEntry проходит), disableLock→setupLock→ready возвращается сам,
событие поднимает потерянную сессию.

## Верификация

- `npm run typecheck` (tsc --noEmit) — чисто, 0 ошибок.
- `npx vitest run tests/unit` — 42 файла, 349 тестов, 0 провалов (все прежние файлы зелёные).
- ESLint по изменённым файлам — 0 ошибок; 6 предупреждений — ранее существовавший
  документированный долг (react-hooks purity/refs/set-state-in-effect), не в изменённых строках.
