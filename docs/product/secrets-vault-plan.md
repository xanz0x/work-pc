# ПЛАН «МЕНЕДЖЕР СЕКРЕТОВ» ДЛЯ WORKSPACEX — 52 пункта (исходник от другой ИИ, дословная выжимка)

Идея: добавить в боковую панель WorkSpaceX полноценный менеджер паролей / seed-фраз / секретов
(«Personal Security Vault»), профессиональный, защищённый, local-first, в стиле проекта.
Копирование в буфер с автоочисткой (10 сек). Далее — все пункты плана.

## ТИПЫ ЗАПИСЕЙ

1. **Login (пароли)** — название, username, email, пароль, URL (несколько), TOTP, recovery codes,
   заметки, теги, папка, favicon, даты создания/изменения/просмотра, срок действия пароля,
   история изменений. Действия: show/copy username/copy password/open website/copy TOTP/generate.
2. **Passkeys** — отдельный тип: сайт, username, relying party, credential metadata, заметки, даты.
   Визуально отличать Password от Passkey.
3. **TOTP/2FA authenticator** — встроенный: генерация, QR-импорт, secret key, issuer, account,
   period, digits, algorithm, автообновление, countdown, копирование кода, HOTP, recovery codes.
4. **Seed-фразы / Crypto Wallet** — название, сеть, адрес, seed (12/24 слова, маскированный),
   passphrase (25-е слово), derivation path, account/index, private/public/xpub ключи, заметки.
   Действия: показать/скрыть/копировать/проверить checksum/сгенерировать seed.
   Предупреждение: никогда не отправлять seed во внешние AI/API.
5. **Private Keys** — BTC/ETH/generic/WIF/SSH/PGP/сертификаты, форматированный viewer,
   копирование с очисткой буфера.
6. **API Keys** — provider, ключ, environment, endpoint, project/org, expiration, scopes, теги.
   Действия: copy/reveal/open dashboard/rotate/mark expired.
7. **SSH** — host, username, port, private/public key, passphrase, fingerprint, config,
   «Copy SSH command» (ssh user@server).
8. **Банковские карты** — cardholder, номер (форматированный), expiration, CVV, PIN, банк,
   billing address. Copy number/expiration/CVV; для CVV короткий timeout.
9. **Identity** — имя, фамилия, дата рождения, телефон, email, адрес, паспортные данные,
   документы, custom fields.
10. **Secure Notes** — полноценный редактор: markdown, code blocks, чеклисты, attachments,
    теги, история, favorite.
11. **Recovery Codes** — список кодов (маскированные), счётчик «8/10 remaining»,
    отметить использованные.
12. **Wi-Fi** — SSID, пароль, security, hidden, notes + сгенерировать QR для подключения телефона.
13. **Software Licenses** — product, ключ, vendor, email, purchase/expiration, invoice.
14. **Documents** — прикрепляемые PDF/изображения/TXT/сертификаты, шифруются вместе с vault.
15. **Custom Entry** — конструктор своей записи: поля (имя, тип, значение, secret/visible,
    copy behavior). Типы полей: text/password/URL/email/number/date/secret/multiline/OTP/file/boolean.

## ГЕНЕРАТОРЫ

16. **Генератор паролей** — длина, uppercase/lowercase/numbers/symbols, ambiguous, memorable,
    strength meter.
17. **Генератор seed** — 12/15/18/21/24 слова, copy, save to vault, проверка checksum.
18. **Generator Hub** — единый хаб: password, passphrase (diceware), PIN, username, API key,
    token, UUID, hex, base64, seed phrase, SSH key pair, recovery codes.

## БЕЗОПАСНОСТЬ ПОВЕДЕНИЯ

19. **Clipboard Security** — автоочистка буфера: 5/10/30/60 сек/никогда; разные timeout по типам
    (пароль 10с, TOTP 5с, CVV 5с, seed 10с, username 30с); «Clear clipboard now»; тост
    «Clears in 10s»; оговорка про стороннее ПО в ОС.
20. **Auto-lock** — по бездействию (1/5/15/30/60 мин), при закрытии, сворачивании,
    блокировке Windows, sleep/hibernate.
21. **Unlock** — master password, biometrics/OS (Windows Hello), WebAuthn/FIDO2, YubiKey
    (проектировать правильно).
22. **Master Password** — strength meter, проверка слабых/reuse, смена с re-keying,
    lockout/brute-force protection, аварийное поведение.
23. **Password Health (Security Center)** — security score X/100, категории: weak, reused, old,
    compromised, missing 2FA, no passkey, duplicate.
24. **Автоматический аудит** — список проблем (4 reused, 2 weak, 3 без 2FA...), клик → записи.
25. **История пароля** — снапшоты с датами, восстановление старого значения.
26. **История изменений записи** — лог событий (пароль изменён, TOTP добавлен...).
27. **Избранное** — ⭐ + секция «Быстрый доступ».
28. **Теги** — #work #crypto..., фильтрация.
29. **Папки** — Personal/Work/Crypto..., drag & drop.
30. **Умный поиск** — по всему содержимому + фильтры type:, tag:, favorite:, expired:.
31. **Интеграция с глобальным поиском Ctrl+K** — vault-записи в общей палитре.
32. **Quick Actions** — контекстное меню: copy password/username/TOTP, open, edit, duplicate,
    move, favorite, delete, lock vault.
33. **Drag & Drop** — записи, папки, файлы, attachments.

## ДАННЫЕ: ИМПОРТ/ЭКСПОРТ/БЭКАП

34. **Импорт** — KeePass, KeePassXC, Bitwarden, 1Password, LastPass, CSV, JSON + preview
    перед импортом (сводка: 143 entries: 102 пароля, 18 заметок, 11 TOTP, 4 карты...).
35. **Экспорт** — encrypted backup, native, CSV, JSON; plaintext — огромное предупреждение +
    подтверждение.
36. **Encrypted Backup** — ручной/автоматический, ротация копий, верификация, restore preview.
37. **Secure Delete** — корзина → безвозвратное удаление.
38. **Attachments** — файлы у записи, шифруются вместе с vault, считаются секретами.
39. **Shared Secrets (архитектурно)** — модель Personal/Shared/Team + permissions (view/copy/
    edit/admin) на будущее, без реализации синхронизации сейчас.

## БЕЗОПАСНОСТЬ СИСТЕМЫ

40. **Безопасность** — local-first; секреты не покидают устройство; encrypted-at-rest;
    шифрованные бэкапы; memory hygiene; auto-lock; clipboard cleanup; brute-force protection;
    audit log; минимизация plaintext в UI; secure reveal; настоящая крипто-архитектура
    (KDF, ключи, nonce/IV, integrity, миграции формата, шифрование бэкапов) + threat model.
41. **Безопасный просмотр** — reveal с авто-скрытием через ~8 сек; скрытие при уходе со страницы.
42. **Copy без показа** — копировать, не раскрывая значение.
43. **Sensitive action confirmation** — подтверждение мастер-паролем или «hold to reveal»
    для показа seed и подобных действий.
44. **Panic Lock** — Ctrl+Shift+L: мгновенно lock + скрыть содержимое + очистить clipboard +
    закрыть sensitive-панели.
45. **Emergency/Duress** — дуress-vault (ложный vault при принуждении) — в advanced security,
    аккуратно проектировать; не в первой реализации.
46. **Secure Notes + Code** — хранение кода с подсветкой синтаксиса, копирование блока.
47. **Expiration** — срок действия у записи (API key, пароль, карта, лицензия, сертификат),
    бейдж EXPIRED.
48. **Reminders** — «пароль не менялся 214 дней», «ключ истекает через 7 дней».
49. **Favicon/metadata** — фавиконы сайтов, но загрузка извне не должна утечь информацией;
    настройка remote content.
50. **Приватность** — настройки: remote favicons off, external metadata off, telemetry off,
    crash reports off (по умолчанию всё выключено).

## UI/UX

51. **Стиль WorkSpaceX** — dark, minimal, technical, premium, dense but readable, зелёный акцент,
    тонкие бордеры, лёгкие glow-состояния; менеджер — родной модуль, не KeePass-клон.
52. **Главный экран** — layout: слева категории (Favorites/All/Passwords/Passkeys/TOTP/Seed/
    API Keys/SSH/Cards/Notes...), сверху поиск + «+ New Secret», SECURITY SCORE, Recent,
    справа панель детали записи (поля с [Copy] [Reveal], TOTP с countdown, теги, last modified).

## УРОВНИ (предложение другой ИИ)

- **CORE (без чего менеджер не существует):** vault, entries, folders, tags, search, login,
  password generator, TOTP, secure notes, clipboard timeout, auto-lock, encryption,
  import/export, backup.
- **ADVANCED:** passkeys, seed, crypto, API keys, SSH, cards, identities, attachments,
  password health, history, expiration, reminders, QR, recovery codes, custom fields.
- **SECURITY+:** hardware keys, biometrics/OS-auth, panic lock, emergency architecture,
  advanced audit, secure migration, key rotation, backup security, threat model,
  hardened memory/clipboard.

## ПОРЯДОК РАБОТЫ (предложение другой ИИ)

Исследовать код → не ломать существующее → спроектировать security architecture →
data model → UX → реализовать модуль → security audit → functional audit →
исправить проблемы → протестировать edge cases. Полное ТЗ + архитектурные ограничения +
security requirements + acceptance criteria.

## ОТКРЫТЫЕ ВОПРОСЫ (другая ИИ просила утвердить)

1) Только локальный vault или будущая синхронизация? 2) Способ открытия vault?
3) Полноценный Passkey/WebAuthn или нет? 4) Насколько глубоко crypto/seed-функции?
5) Нужен ли встроенный autofill браузера? 6) Какие импорты обязательны?
