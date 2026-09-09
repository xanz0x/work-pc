# WorkSpaceX: ключ восстановления замка сейфа — статус

Схема BitLocker: под отдельным 256-битным recovery-секретом (код `WSXR-<43 симв. base64url>`)
в localStorage `wf.lock.recovery` хранится зашифрованная СТРОКА мастер-секрета.
Утеря мастер-ключа больше не уничтожает защищённые данные.

## Готово

- `lib/crypto-vault.ts`:
  - `RECOVERY_KEY = 'wf.lock.recovery'`, `RECOVERY_CODE_PREFIX = 'WSXR-'`, `type RecoveryBlob`;
  - `recoveryCodeFromBytes` / `recoveryBytesFromCode` (код = `'WSXR-' + base64url(32 байта)`);
  - `createRecoveryForSecret(secret)` — генерирует новый recovery-секрет, отдельная соль,
    PBKDF2 той же стоимости (600k), `aesEncrypt(recoveryKey, JSON {masterSecret})`;
  - `recoverMasterSecret(code)` — расшифровка блоба → строка мастер-секрета (мастер-ключ
    из кода НЕ восстанавливается — восстанавливается только знание секрета).
- `lib/store/lock.tsx`:
  - `setupLock` / `changeMaster` создают recovery-запись и ВОЗВРАЩАЮТ код (`Promise<string|null>`);
  - `recoverWithKey(code, newSecret)`: расшифровка → `verifyMasterSecret` старого секрета →
    `setMasterSecret(newSecret)` → `rewrapAll(oldKey→newKey)` → `adoptMasterSession(newSecret)` →
    сброс счётчиков → запись в журнал (`lock-recovered`) → удаление recovery-записи (одноразовость);
  - отдельные recovery-попытки: до 5 без роста failCount мастера, после — кулдаун `failDelayMs`;
  - после recovery новый код НЕ выдаётся — подсказка зайти в «Сменить мастер-ключ».
- `lib/lock-store.ts`: `hasRecoveryCode`, recovery-счётчики/кулдаун в LockState,
  `wipeLockData` стирает запись.
- `lib/vault-store.tsx`: прокидывает `recoverWithKey`, `recoveryCooldownUntil` в UI.
- `lib/journal.ts`: новый вид записи `lock-recovered` («Вход по коду восстановления»).
- `lib/telemetry.ts`: события `lock.recovery` (action) и `lock.recovery.failed` (drop).
- `components/screen-activity.tsx`: иконка для `lock-recovered` в JKIND_ICON.
- `components/recovery-key-dialog.tsx` (НОВЫЙ):
  - `RecoveryCodeCard` — код показывается ОДИН раз, «Скопировать» + предупреждение
    «Запиши код — он показывается один раз; без него при утере мастер-ключа данные будут потеряны»;
  - `RecoveryDialog` — две вкладки: «Есть код восстановления» (код + новый мастер-пароль +
    подтверждение → `recoverWithKey`; при неверном коде — «Код не подходит») и «Кода нет»
    (прежний деструктивный путь: предупреждение ResetLockDialog + ввод СБРОСИТЬ + wipeLockData);
  - стили по access.css / mk-card (mk-title, mk-sub, mk-err, mk-note, mk-warn, mk-submit).
- `components/screen-lock.tsx`: кнопка «Не помню мастер-ключ» открывает `RecoveryDialog`.
- `components/security-section.tsx`, `components/onboarding.tsx`: после `setupLock`/`changeMaster`
  показ `RecoveryCodeCard` один раз (test-id `mk-recovery-code`, `onb-recovery-code`).
- `tests/unit/recovery-key.test.tsx` (НОВЫЙ, 8 тестов): формат кода; генерация → восстановление
  старого секрета; смена мастера выдаёт новый код, старый мёртв; неверный код; одноразовость;
  полный цикл через store (setupLock → recoverWithKey → перезапаковка файлового ключа и SEK);
  анти-брутфорс (кулдаун, failCount мастера не растёт).

## Формат кода

`WSXR-` + ровно 43 символа base64url (32 байта). Показывается один раз при включении/смене
мастер-ключа; новый код выдаётся только при следующем `changeMaster`/`setupLock`.

## Проверено

- `node_modules/.bin/tsc --noEmit` — чисто.
- `node_modules/.bin/vitest run tests/unit/recovery-key.test.tsx` — 8/8 зелёные.
- Полный `node_modules/.bin/vitest run tests/unit` — 41 файл, 325/325 (было 317/317 + 8 новых).