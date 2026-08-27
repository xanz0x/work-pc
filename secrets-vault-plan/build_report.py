# -*- coding: utf-8 -*-
"""Сборка HTML-отчёта «Менеджер секретов — план на утверждение» в стиле Графит."""
import datetime

DATE = datetime.date.today().strftime('%d.%m.%Y')

# ---------- вердикты ----------
TAGS = {
    'take':    ('ВЗЯТЬ', 't-take'),        # уже есть в проекте, использовать как есть
    'mine':    ('МОЁ · ДОСТРОИТЬ', 't-mine'),   # фундамент есть, надстроить
    'build':   ('СТРОИТЬ', 't-build'),     # новое, строить
    'rethink': ('СКОРЕКТИРОВАТЬ', 't-rethink'),  # брать с изменённым подходом
    'defer':   ('ОТЛОЖИТЬ', 't-rethink'),  # не в v1, но в дорожной карте
    'cut':     ('НЕ ДЕЛАТЬ', 't-cut'),     # выкинуть из плана
}

# (№, название, что предлагает план (коротко), что есть в проекте, вердикт, комментарий)
MATRIX = {
'Типы записей': [
 (1,'Login (пароли)','Полная карточка аккаунта: username, пароль, URL, TOTP, история','Нет аналога; есть файлы+стикеры, записей-аккаунтов нет','build','Ядро модуля. Новая сущность Entry с шаблоном login'),
 (2,'Passkeys','Отдельный тип записи + визуальное отличие от пароля','Нет','rethink','Карточка-passkey с метаданными — да. Настоящий WebAuthn-провайдер браузер не даёт создать (креды не покидают authenticator) — не обещать'),
 (3,'TOTP / 2FA','Встроенный аутентификатор: коды, countdown, QR','Нет','build','TOTP = HMAC-SHA1 + Base32 — реализуемо на WebCrypto, zero-dep сохраняется. QR-сканирование камерой — отложить (v1: вставка otpauth:// строки)'),
 (4,'Seed-фразы / Wallet','Маскированная seed, 25-е слово, derivation path, проверка','Нет','build','BIP39-словарь (2048 слов) вшивается локально; checksum проверяется локально. Никакой деривации ключей и транзакций — это зона кошелька, опасно'),
 (5,'Private Keys','Viewer ключей BTC/ETH/SSH/PGP','Нет','build','Тип записи с форматированным просмотром и маскировкой. Деривацию из seed не делаем'),
 (6,'API Keys','Provider, environment, scopes, expiration, rotate','Нет; есть демо-API-ключ в примерах','build','Rotate = локальная замена значения + запись в историю (без вызовов внешних API)'),
 (7,'SSH','Host/port/key/fingerprint + Copy SSH command','Нет','build','Тип записи. Генерацию пары ключей — НЕ делать (ed25519 нет в WebCrypto): хранить и копировать — да'),
 (8,'Банковские карты','Форматированный номер, CVV, PIN','Нет','build','Тип записи; для CVV/PIN — самый короткий таймаут буфера (5с)'),
 (9,'Identity','Личные данные, документы, custom fields','Нет','build','Тип записи'),
 (10,'Secure Notes','Markdown, чеклисты, вложения, история','СТикеры уже: title, body, tags, TTL, замок, пин к файлу','mine','Не строить новый тип с нуля — расширить модель стикера (lib/notes.ts) до secure-note; заметки остаются вторым слоем памяти'),
 (11,'Recovery Codes','Список кодов, «8/10 remaining», отметить использованные','Нет','build','Тип записи с чек-списком'),
 (12,'Wi-Fi','SSID, пароль, QR для подключения','Нет','build','Тип записи. QR-рендер — своя мини-реализация (zero-dep) либо v1 без QR'),
 (13,'Licenses','Ключ продукта, vendor, invoice','Нет','build','Тип записи'),
 (14,'Documents','Вложения, зашифрованные вместе с vault','Файловый сейф УЖЕ шифруется файловыми ключами (этап 5 замка)','mine','Вложение = тот же зашифрованный объект сейфа, приколотый к записи. Переиспользовать класс файла'),
 (15,'Custom Entry','Конструктор своих полей (11 типов)','Нет','build','Обязателен — снимает будущие просьбы «добавьте тип»'),
],
'Генераторы': [
 (16,'Генератор паролей','Длина, наборы символов, strength meter','crypto.getRandomValues есть; генератора нет','build','Чистый CSPRNG из WebCrypto'),
 (17,'Генератор seed','12/15/18/21/24 слова, checksum, save','Нет','build','Тот же BIP39-словарь, что п.4'),
 (18,'Generator Hub','Единый хаб: password/passphrase/PIN/token/UUID/seed','Нет','build','Один экран генераторов; passphrase — словарь BIP39, PIN/UUID/hex/base64 — тривиально на CSPRNG'),
],
'Поведение и защита': [
 (19,'Clipboard timeout','Автоочистка буфера 5/10/30/60с, разные таймауты по типам','Только голый navigator.clipboard.writeText в чате; очистки нет','build','Обёртка copySecret() + тост «Очистится через 10с» + «Очистить сейчас». Честная оговорка: сторонний менеджер буфера в ОС может сохранить копию'),
 (20,'Auto-lock','По бездействию, сворачиванию, блокировке ОС','УЖЕ ЕСТЬ: автоблокировка приложения (выкл/5/10/15/30 мин) в экране замка','mine','Vault живёт под общим замком приложения — второй замок не плодим'),
 (21,'Unlock: биометрия/FIDO2','Windows Hello, YubiKey','Нет','defer','WebAuthn PRF-расширение в браузерном прототипе — экзотика; отложить в SECURITY+, не в v1'),
 (22,'Master password','Strength meter, re-keying, brute-force защита','УЖЕ ЕСТЬ: PBKDF2 310k→AES-GCM, verifier, смена ключа, задержки 1→30с','mine','Взять как есть; поднять итерации до 600k (OWASP 2024) в миграции формата vault'),
 (23,'Password Health','Security score, weak/reused/old/compromised','Нет','rethink','Локальные проверки (weak/reuse/old/duplicate) — да. Проверка утечек через внешний API — НЕТ (утечка хешей наружу противоречит local-first); вариант — офлайн-список, помечаем честно'),
 (24,'Автоаудит','Список проблем → клик к записям','Нет','build','Производная от п.23'),
 (25,'История пароля','Снапшоты, восстановление','Нет','build','Снапшот при каждом изменении секретного поля'),
 (26,'История записи','Лог событий','Частично: лента событий сейфа уже есть (замок пишет в неё)','mine','Продолжить общий журнал — событие «изменена запись» в ту же ленту'),
 (27,'Избранное','⭐ + быстрый доступ','Нет','build','Тривиальное поле + секция'),
 (28,'Теги','#work #crypto, фильтры','СТикеры уже имеют tags: string[]','mine','То же поле у записей; единый паттерн с библиотекой'),
 (29,'Папки','Группы + drag&drop','Аналог: кластеры у файлов','build','Папки записей по образцу кластеров; drag&drop — v1.1'),
 (30,'Умный поиск','Поиск по содержимому + фильтры type:/tag:','УЖЕ ЕСТЬ: единая search() с типами hit (file/note/chat/cluster/setting)','mine','Добавить kind «secret» — секреты появятся везде: топбар, Ctrl+K, карта'),
 (31,'Ctrl+K интеграция','Vault в глобальной палитре','УЖЕ ЕСТЬ палитра (command-palette.tsx) на общем поиске','take','Достаётся бесплатно из п.30'),
 (32,'Quick Actions','Контекстное меню записи','Есть dropdown.tsx','build','Меню на базе существующего компонента'),
 (33,'Drag & Drop','Записи, папки, файлы','Drag есть на доске библиотеки','defer','На записях — не в v1'),
],
'Данные: импорт/экспорт': [
 (34,'Импорт','KeePass, Bitwarden, 1Password, LastPass, CSV, JSON','Нет','rethink','Реальный путь: CSV (универсальный экспорт из ВСЕХ менеджеров) + Bitwarden JSON. Нативный разбор .kdbx — не делать (это отдельная криптосистема),.preview перед импортом — да'),
 (35,'Экспорт','Encrypted / CSV / JSON с предупреждением','Нет','build','Encrypted-экспорт тем же AES-GCM; plaintext — красное предупреждение + подтверждение'),
 (36,'Encrypted Backup','Ручной/авто, ротация, restore preview','Нет','build','Бэкап = зашифрованный снимок localStorage-сейфа в файл'),
 (37,'Secure Delete','Корзина → безвозвратно','Нет','build','Мягкое удаление + очистка'),
 (38,'Attachments','Файлы у записи','Файловые ключи уже умеют шифровать файлы','mine','См. п.14'),
 (39,'Shared/Team модель','Personal/Shared/Team + permissions','Нет','cut','Local-first соло-продукт: модель sharing в v1 не строим; только версии схемы, чтобы не закрыть дверь навсегда'),
],
'Безопасность системы': [
 (40,'Крипто-архитектура','KDF, ключи, IV, миграции, threat model','ЯДРО УЖЕ ЕСТЬ: crypto-vault.ts — PBKDF2+AES-GCM-256, IV, verifier, file keys, анти-брутфорс','mine','Для vault: отдельная схема шифрования записей с версионированием формата и миграциями; итерации 310k→600k; threat model — раздел ТЗ'),
 (41,'Secure reveal','Авто-скрытие показанного секрета ~8с','Нет','build','Тривиально; плюс скрытие при уходе со страницы'),
 (42,'Copy без показа','Копировать с маскированного поля','Нет','build','Связано с п.19'),
 (43,'Sensitive confirmation','Мастер-пароль или hold-to-reveal для seed','verifyMasterSecret уже есть','build','Для показа seed/ключа — повторный мастер-пароль (готовая функция) или hold-кнопка'),
 (44,'Panic Lock','Ctrl+Shift+L: lock+скрыть+очистить буфер','УЖЕ ЕСТЬ: Ctrl+Shift+L → lockNow() всего приложения','mine','Расширить lockNow(): + очистка clipboard, + закрытие открытых секретов'),
 (45,'Duress vault','Ложный vault при принуждении','Нет','cut','Сам план признаёт:高风险 ложного чувства защиты. Из v1 исключить, вернуться в отдельном исследовании'),
 (46,'Code notes','Код с подсветкой, копирование блока','Нет','defer','v1: моно-шрифт без подсветки (честно и достаточно), подсветка — потом'),
 (47,'Expiration','Срок действия записи, бейдж EXPIRED','У стикеров УЖЕ есть expiresAt + полоса распада','mine','Тот же паттерн, другая семантика: не самоуничтожение, а напоминание'),
 (48,'Reminders','«Пароль не менялся N дней»','Нет','build','Вычисляется из истории и expiration'),
 (49,'Favicon','Иконки сайтов','Нет','build','Иконки подтягиваются с сайта автоматически, кэшируются локально в сейфе; офлайн-монограмма — фолбэк, пока иконка не получена или тумблер выключен. Передаётся только домен, никогда — данные записи'),
 (50,'Приватность','Тумблеры remote/telemetry','Telemetry и так нет (local-first)','build','Настройка «удалённый контент: выкл» по умолчанию — задокументировать, что внешних запросов нет'),
],
'UI / стиль': [
 (51,'Стиль WorkfloW','Dark, минимал, зелёный акцент, без KeePass-клона','Дизайн-система «Графит v3.1» — готовые токены','take','Модуль обязан использовать только существующие токены/классы'),
 (52,'Главный экран','Layout: категории, поиск, score, детали','Нет; паттерн экранов есть (ScreenId)','build','Новый ScreenId «vault» + трёхколоночный экран по образцу библиотеки'),
],
}

# ---------- фундамент (что уже построено) ----------
FOUNDATION = [
 ('Замок и криптографическое ядро','lib/crypto-vault.ts · lib/lock-store.tsx · components/screen-lock.tsx · security-section.tsx','PBKDF2-HMAC-SHA256 (310k) → AES-GCM-256, verifier-схема, мастер-ключ не кэшируется, файловые ключи (2-й уровень), задержки 1→30с при брутфорсе, автоблокировка, Ctrl+Shift+L, BroadcastChannel-синк вкладок'),
 ('Глобальный поиск','lib/search.ts · components/command-palette.tsx','Одна функция на всё приложение: топбар, Ctrl+K, фильтр библиотеки и подсветка карты. Типы хитов расширяются — секреты встанут в общую палитру'),
 ('Файловый сейф с шифрованием','lib/vault-store.tsx · lib/data.ts','Файлы шифруются файловыми ключами (этап 5 LOCK-FEATURE-PLAN). Вложения vault-записей построятся на этом же классе объектов'),
 ('Стикеры-заметки','lib/notes.ts','Второй слой памяти: title, body, tags, TTL с полосой распада, локальный замок, пин к файлу. Готовая база для Secure Notes иExpiration'),
 ('Кластеры и дизайн-система «Графит v3.1»','app/globals.css · lib/graph.ts','Токены (--accent #2fbe7e, --border, --raise), паттерн группировки (кластеры), IBM Plex Sans/Mono. Менеджер обязан выглядеть родным модулем'),
 ('Лента событий и настройки','vault-store · screen-settings.tsx · security-section.tsx','Общий журнал событий сейфа (замок уже пишет в него), секция «Безопасность» с созданием/сменой мастер-ключа — туда же лягут настройки vault'),
 ('Redact-контекст ИИ','lib/redact-context.tsx','Заблокированные объекты уже исключаются из источников ответов чата. Для vault это станет железным правилом: секреты не попадают в контекст локальной ИИ — ни в источники, ни в смысловой индекс'),
 ('Тумблеры приватности','screen-settings.tsx · v.settings.toggles','Экран настроек уже умеет вкл/выкл-переключатели с предупреждениями (OCR, telemetry и др.) — настройки vault (remote content, clipboard timeout) встанут в тот же паттерн'),
]

# ---------- переработки ----------
REUSE = [
 ('Замок приложения → замок vault-а','Vault не получает свой отдельный замок — он живёт под существующим общим замком. Файловые ключи (2-й уровень) применяются к отдельным записям (seed, карты)'),
 ('Ctrl+Shift+L → Panic Lock','lockNow() дополняется: очистка буфера обмена + закрытие открытых секретов. Хоткей и экран уже существуют'),
 ('Стикеры → Secure Notes','Модель стикера расширяется (markdown/чеклист) — не плодим третью сущность «заметка»'),
 ('TTL-полоса распада → Expiration','Визуальный паттерн самоуничтожения стикера переиспользуется для «истекает через…» у API-ключей и паролей'),
 ('Кластеры → папки записей','Паттерн цветной группировки файлов переносится на группы записей'),
 ('Единый поиск → поиск по секретам','kind «secret» в search() — секреты находятся в топбаре, Ctrl+K и палитре без отдельного поиска'),
]
CUT = [
 ('Duress vault (ложный vault)','Опасно ложным чувством защиты; криптографически сложно сделать честно. Вне v1'),
 ('Полноценный WebAuthn/passkey-провайдер','Браузер не отдаёт приватный материал креденшелов — можно хранить только метаданные. Не обещать в UI'),
 ('Разбор .kdbx (KeePass) нативно','Отдельная криптосистема (AES/ECC контейнеры) — импорт через CSV-экспорт из KeePassXC'),
 ('Онлайн-проверка утечек (HIBP API)','Отправка хешей паролей наружу противоречит local-first. Только локальные проверки'),
 ('Team/Shared permissions','Соло-продукт. Оставляем версионирование схемы, чтобы не закрыть дверь'),
 ('Генерация SSH-пар ключей','ed25519 недоступен в WebCrypto; хранить/копировать — да, генерировать — нет'),
 ('Drag&drop папок записей','Не в v1 — сначала сами папки'),
 ('Автозаполнение в браузере (autofill)','Расширение к браузеру — отдельный большой проект, не модуль'),
]

# ---------- открытые вопросы ----------
QUESTIONS = [
 ('Хранилище: только локально или с прицелом на синхронизацию?','ТОЛЬКО ЛОКАЛЬНО','Синхронизацию не строим. Формат хранилища версионирован (v:1), чтобы будущая синк-модель была возможна, — но в v1 ни одного сетевого вызова с секретами'),
 ('Как vault открывается?','ОБЩИЙ ЗАМОК ПРИЛОЖЕНИЯ','Замок уже есть (мастер-пароль/PIN + автоблокировка). Второй замок поверх — лишнее трение. Для отдельных записей (seed/карты) — файловый ключ 2-го уровня'),
 ('Полноценный Passkey/WebAuthn?','НЕТ · ТОЛЬКО КАРТОЧКА-МЕТADATA','Браузер не позволяет экспортировать приватный материал passkey. Храним метаданные (сайт, username, заметки) и визуально отличаем от пароля'),
 ('Насколько глубоко идут crypto/seed-функции?','ХРАНЕНИЕ + ГЕНЕРАЦИЯ BIP39','Генерация и проверка seed — да. Деривация приватных ключей из seed, подписание транзакций — НЕТ: это зона кошелька, там цена ошибки необратима'),
 ('Нужен ли autofill в браузере?','НЕТ (V1)','Прототип живёт в браузере без расширения. Autofill = отдельный проект с расширением. В v1: быстрый поиск + копирование в буфер'),
 ('Какие импорты обязательны?','CSV + BITWARDEN JSON','CSV умеют экспортировать KeePassXC, Bitwarden, 1Password, LastPass — один парсер закрывает всё. Нативные .kdbx/.1pux — нет'),
]

# ---------- уровни ----------
LEVELS = [
 ('CORE · v1.0','Фундамент без которого менеджера нет','Записи+шаблоны (login, note, card, api) · Custom fields · Папки/теги/избранное · Поиск (kind: secret, Ctrl+K) · Генератор паролей/PIN · TOTP · Clipboard timeout · Reveal с авто-скрытием · Крипто-ядро на базе замка (600k) · Экспорт/импорт CSV+JSON · Encrypted backup · Корзина · Panic Lock+ (буфер) · Экран vault в стиле Графит'),
 ('ADVANCED · v1.1+','Глубина профессионального продукта','Seed-фразы (BIP39+checksum) · Generator Hub (passphrase/UUID/token) · SSH/Identity/License/Wi-Fi/Recovery · История паролей и записей · Expiration+Reminders · Password Health (локальный) · QR · Вложения · Passkey-карточки'),
 ('SECURITY+ · v2 · по согласованию','То, что требует отдельного проектирования','Biometrics/OS-auth (WebAuthn PRF) · Duress-архитектура · Расширенный аудит · Key rotation церемонии · Подсветка кода в заметках · Drag&drop · Autofill-исследование'),
]

# ---------- чек-лист утверждения ----------
APPROVE = [
 ('Хранилище','Только локально, формат v1 с прицелом на будущее (без синхронизации в v1)'),
 ('Замок','Общий замок приложения; файловый ключ 2-го уровня для отдельных записей'),
 ('Passkeys','Карточка с метаданными; настоящий WebAuthn-провайдер — нет'),
 ('Seed-функции','Генерация + проверка BIP39; без деривации ключей и транзакций'),
 ('Autofill','Не делать в v1'),
 ('Импорт','CSV (универсальный) + Bitwarden JSON; без нативного .kdbx'),
 ('Утечки (breach check)','Только локальные проверки; без внешних API'),
 ('Duress vault','Исключить из v1'),
 ('Secure Notes','На базе модели стикеров (расширение), не отдельная сущность'),
 ('Favicon','Иконки подтягиваются с сайта автоматически и кэшируются локально; монограмма — фолбэк. Внешний вызов получает только домен — ни одного секрета'),
]

# ================================================================
def tag_html(v):
    name, cls = TAGS[v]
    return f'<span class="tag {cls}">{name}</span>'

def matrix_table(items):
    rows = []
    for num, title, plan, have, verdict, comment in items:
        rows.append(f'''<tr>
<td class="num">{num:02d}</td>
<td class="item"><b>{title}</b><div class="d">{plan}</div></td>
<td>{have}</td>
<td>{tag_html(verdict)}<div class="d" style="margin-top:3px">{comment}</div></td>
</tr>''')
    return f'''<table>
<thead><tr><th style="width:7mm">№</th><th style="width:62mm">Пункт плана</th><th style="width:47mm">Что есть в проекте</th><th>Вердикт и решение</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>'''

def page(kicker, title, sub, body, n):
    return f'''<div class="page" id="p{n}">
<div class="kicker">{kicker}</div><h2>{title}</h2><div class="h-sub">{sub}</div>
{body}
<div class="footer"><span>WORKFLO W · Менеджер секретов · ТЗ v1</span><span>{n}</span></div>
</div>'''

pages = []
n = 0
def nxt():
    global n
    n += 1
    return f'{n:02d}'

# ---- стр 2: резюме ----
summary_body = '''
<div class="cols">
  <div class="col stat"><div class="n">52</div><div class="l">пункта плана разобрано</div></div>
  <div class="col stat"><div class="n">14</div><div class="l">уже построено · взять и достроить</div></div>
  <div class="col stat"><div class="n">26</div><div class="l">новое · строить</div></div>
  <div class="col stat"><div class="n">12</div><div class="l">скорректировать / отложить / не делать</div></div>
</div>
<div class="callout" style="margin-top:14px"><b class="t">Главный вывод</b>
План от другой ИИ качественный, но написан «в вакууме»: он не знает, что в проекте уже работает
настоящая криптография (PBKDF2→AES-GCM-256), общий замок с автоблокировкой, Panic-хоткей
Ctrl+Shift+L, единый поиск с палитрой, зашифрованный файловый сейф и стикеры с TTL и тегами.
Из 52 пунктов <b>четверть уже построена или почти готова</b> — их надо не строить, а переиспользовать.
Ещё часть противоречит принципу local-first (онлайн-проверка утечек, полноценные passkeys, duress) —
эти пункты вырезаны или переформулированы.</div>
<h3>Топ-5 решений, которые нужно утвердить</h3>
<table>
<tr><td class="num">1</td><td class="item"><b>Vault живёт под общим замком приложения</b><div class="d">Никакого второго замка: экран блокировки, автоблокировка и Ctrl+Shift+L уже работают</div></td><td>п.20–22, 44</td></tr>
<tr><td class="num">2</td><td class="item"><b>Стикеры становятся Secure Notes</b><div class="d">Модель стикера расширяется, а не создаётся третья сущность «заметка»</div></td><td>п.10</td></tr>
<tr><td class="num">3</td><td class="item"><b>Локальные проверки здоровья</b><div class="d">Weak/reuse/old — локально; внешних API для утечек — никогда</div></td><td>п.23</td></tr>
<tr><td class="num">4</td><td class="item"><b>Seed: генерация и хранение — да; деривация ключей — нет</b><div class="d">Не превращаем менеджер в кошелёк</div></td><td>п.4, 17</td></tr>
<tr><td class="num">5</td><td class="item"><b>Импорт через CSV + Bitwarden JSON</b><div class="d">Один парсер закрывает KeePassXC/1Password/LastPass; .kdbx не разбираем</div></td><td>п.34</td></tr>
</table>
<div class="callout warn"><b class="t">Как читать документ</b>
Сначала стр. «Утверждение» — 10 вопросов с чекбоксами. Потом матрица 52 пунктов — вердикт по каждому.
Спорные пункты помечены «СКОРЕКТИРОВАТЬ»: рядом — как именно меняется предложение.</div>
'''
pages.append(page('РЕЗЮМЕ','Что решили за вас и что — за вами','Gap-анализ плана 52 пунктов против реального кода vault-core-arch', summary_body, nxt()))

# ---- стр 3: фундамент ----
f_rows = ''.join(f'''<tr><td class="item"><b>{t}</b><div class="d">{files}</div></td><td>{desc}</td></tr>''' for t, files, desc in FOUNDATION)
foundation_body = f'''<table>
<thead><tr><th style="width:52mm">Фундамент</th><th>Что уже умеет</th></tr></thead>
<tbody>{f_rows}</tbody></table>
<div class="callout"><b class="t">Почему это важно</b>
Другая ИИ предлагала «спроектировать криптографическую архитектуру с нуля». Она уже спроектирована
и работает (LOCK-FEATURE-PLAN, замок принят в феврале). Задача vault — надстроить схему шифрования
записей над готовым ядром и поднять KDF до актуальных рекомендаций (310k → 600k итераций) в миграции v1.</div>'''
pages.append(page('ФУНДАМЕНТ','Что уже построено и переиспользуется','Восемь несущих конструкций vault-core-arch — на них встаёт менеджер', foundation_body, nxt()))

# ---- матрица ----
matrix_intro = 'Каждому пункту плана — вердикт: <span class="tag t-take">ВЗЯТЬ</span> уже работает · <span class="tag t-mine">МОЁ · ДОСТРОИТЬ</span> фундамент есть · <span class="tag t-build">СТРОИТЬ</span> новое · <span class="tag t-rethink">СКОРЕКТИРОВАТЬ</span> менять подход · <span class="tag t-rethink">ОТЛОЖИТЬ</span> не в v1 · <span class="tag t-cut">НЕ ДЕЛАТЬ</span> вырезано'
page_breakers = {'Поведение и защита': ['Поведение · 1/2','Поведение · 2/2']}
half = {}
def matrix_pages():
    out = []
    # раскладка по страницам
    groups = list(MATRIX.items())
    layouts = []
    for name, items in groups:
        if name == 'Типы записей':
            layouts.append((f'Типы записей · 1/2', items[:8]))
            layouts.append((f'Типы записей · 2/2', items[8:]))
        elif name == 'Поведение и защита':
            layouts.append(('Поведение и защита · 1/2', items[:8]))
            layouts.append(('Поведение и защита · 2/2', items[8:]))
        else:
            layouts.append((name, items))
    for i,(title, items) in enumerate(layouts):
        kick = 'МАТРИЦА РЕШЕНИЙ'
        sub = matrix_intro if i == 0 else 'Продолжение таблицы вердиктов'
        pages.append(page(kick, title, sub, matrix_table(items), nxt()))
matrix_pages()

# ---- переработки ----
reuse_rows = ''.join(f'<tr><td class="item"><b>{a}</b></td><td>{b}</td></tr>' for a,b in REUSE)
cut_rows = ''.join(f'<tr><td class="item"><b>{a}</b></td><td>{b}</td></tr>' for a,b in CUT)
reuse_body = f'''<h3>Переработать из существующего — не строить заново</h3>
<table><thead><tr><th style="width:52mm">Узел проекта</th><th>Как работает на vault</th></tr></thead><tbody>{reuse_rows}</tbody></table>
<h3>Вырезано из плана — с аргументами</h3>
<table><thead><tr><th style="width:52mm">Пункт</th><th>Почему нет</th></tr></thead><tbody>{cut_rows}</tbody></table>'''
pages.append(page('ПЕРЕРАБОТКА','Своё ближе: что вынести и что вырезать','Слева — узлы проекта, которые становятся частью менеджера. Снизу — пункты, которые я предлагаю не делать', reuse_body, nxt()))

# ---- вопросы ----
q_rows = ''.join(f'''<tr><td class="item"><b>{q}</b></td><td>{tag_html('take').replace('ВЗЯТЬ','РЕКОМЕНДАЦИЯ')}</td><td><b>{a}</b><div class="d">{why}</div></td></tr>''' for q,a,why in QUESTIONS)
questions_body = f'''<table>
<thead><tr><th style="width:44mm">Вопрос (из исходного плана)</th><th></th><th>Моя рекомендация</th></tr></thead>
<tbody>{q_rows}</tbody></table>
<div class="callout"><b class="t">Принцип рекомендаций</b>
Всё, что можно не делать в v1 — не делается. Каждый «нет» обоснован реальным кодом проекта и принципом
local-first: ни один секрет не покидает устройство, ни один внешний вызов не получает контекст.</div>'''
pages.append(page('ОТКРЫТЫЕ ВОПРОСЫ','Шесть развилок — с рекомендациями','Эти решения меняют объём работ; утверди или перепиши', questions_body, nxt()))

# ---- уровни ----
lv_rows = ''.join(f'''<tr><td class="item"><b>{name}</b><div class="d">{desc}</div></td><td>{scope}</td></tr>''' for name,desc,scope in LEVELS)
levels_body = f'''<table><thead><tr><th style="width:44mm">Уровень</th><th>Состав</th></tr></thead><tbody>{lv_rows}</tbody></table>
<h3>Порядок работ (утверждённая схема)</h3>
<div class="cols">
<div class="col stat"><div class="l" style="color:var(--accent)">шаг 1</div><div style="margin-top:4px">Исследовать код → зафиксировать архитектуру и модель данных (не ломая существующее)</div></div>
<div class="col stat"><div class="l" style="color:var(--accent)">шаг 2</div><div style="margin-top:4px">Крипто-схема записей поверх замка → data model → UX-каркас</div></div>
<div class="col stat"><div class="l" style="color:var(--accent)">шаг 3</div><div style="margin-top:4px">CORE → приёмка: tsc, ручные сценарии, edge cases</div></div>
<div class="col stat"><div class="l" style="color:var(--accent)">шаг 4</div><div style="margin-top:4px">Security-аудит → функциональный аудит → исправления → ADVANCED</div></div>
</div>'''
pages.append(page('УРОВНИ И ПОРЯДОК','Что в каком релизе','План разделён на уровни, чтобы Claude не свалил всё в одну кашу', levels_body, nxt()))

# ---- схема сайдбара ----
def smrow(icon, label, right='', sec=False, acc=False, dim=False, badge=''):
    cls = 'sm-row' + (' dim' if dim else '')
    ic = f'<div class="sm-ic acc">{icon}</div>' if acc else f'<div class="sm-ic">{icon}</div>'
    r = badge if badge else (f'<span class="sm-n">{right}</span>' if right else '')
    sec_lbl = f'<span class="sm-sec{" acc" if acc else ""}">{label}</span>'
    body = sec_lbl if sec else f'<span><b>{label}</b></span>'
    return f'<div class="{cls}">{ic}{body}{r}</div>'

sidebar_html = ''.join([
  smrow('⌂','РАБОЧЕЕ МЕСТО', sec=True),
  smrow('▤','Библиотека','14'),
  smrow('◈','Карта памяти','32'),
  smrow('◌','Чат с ИИ','1'),
  smrow('≡','СЕКРЕТЫ', sec=True, acc=True, badge='НОВЫЙ РАЗДЕЛ'),
  smrow('◇','Менеджер секретов','17', acc=True),
  smrow('≡','СИСТЕМА', sec=True),
  smrow('⚙','Настройки','', dim=True),
  smrow('●','Qwen 2.5 7B · 26 ток/с','', dim=True),
])

sidebar_right = '''
<div class="sm-block"><h4>Боковая панель: +1 кнопка, не +20</h4>
<p>В сайдбаре появляется один пункт — «Менеджер секретов». Никаких 15 категорий в навигации:
категории, поиск, генераторы и здоровье паролей живут <b>внутри экрана</b> модуля, как в Библиотеке
живут фильтры и стикеры. Структура всегда читается слева направо: <b>где я → что открыто → что делать</b>.</p></div>
<div class="sm-block"><h4>Внутри экрана «Менеджер секретов» (3 колонки)</h4>
<p><b>Левая колонка · навигация по записям:</b> поиск + фильтры (type:, tag:) → Избранное → Все →
Типы (Пароли, TOTP, Seed, API-ключи, Карты, SSH, Заметки…) → Папки (Personal, Work, Crypto…) →
Корзина.<br>
<b>Центр · список записей:</b> карточки с иконкой сайта (подтягивается автоматически),
названием, маскированным значением и бейджами (истекает, слабый).<br>
<b>Правая колонка · деталь записи:</b> поля с [Copy] и [Reveal], TOTP с обратным отсчётом,
история изменений, вложения, теги.</p></div>
<div class="sm-block"><h4>Генераторы и Security Center — не отдельные экраны сайдбара</h4>
<p>Генератор пароля/seed открывается из места действия: кнопка «⋮» у поля пароля или «+ Новая запись».
Security Center (score, слабые, дубли) — вкладка внутри модуля рядом с поиском, как переключение
вида списка. Сайдбар остаётся прежним — меньше точек входа, меньше каши.</p></div>
<div class="sm-block"><h4>Правило роста</h4>
<p>Каждая новая функция получает место по порядку: <b>поле записи → колонка списка → вкладка модуля →
отдельный экран → пункт сайдбара</b>. Пункт сайдбара — только если функция нужна чаще раза в день
и вне контекста модуля (как Чат). Пока что таким правом обладает только «Менеджер секретов».</p></div>
'''

sidebar_body = f'''<div class="legend"><span><i class="sw-new"></i>новое</span><span><i class="sw-old"></i>существующее</span></div>
<div class="side-map">
  <div class="sm-side">
    <div class="sm-head"><span>Сайдбар после v1</span><span>сегодня + 1</span></div>
    {sidebar_html}
  </div>
  <div class="sm-right">{sidebar_right}</div>
</div>'''
pages.append(page('АРХИТЕКТУРА САЙДБАРА','Где что лежит','Схема навигации: сайдбар меняется на одну кнопку, вся глубина — внутри экрана модуля', sidebar_body, nxt()))

# ---- утверждение ----
appr_rows = ''.join(f'''<div class="q"><div class="box"></div><div style="flex:1"><div class="qt">{topic}</div><div class="qd">{rec}</div></div></div>''' for topic, rec in APPROVE)
approve_body = f'''<p>Если напротив пункта нет твоей правки — считаем утверждённым как написано.
Правки пиши прямо в этом листе или сообщением — уйдут в ТЗ для Claude Opus 5.</p>
<div class="approve">{appr_rows}</div>
<div class="signature"><div>УТВЕРЖДАЮ · подпись / дата</div><div>С ПРАВКАМИ · что изменить</div></div>'''
pages.append(page('УТВЕРЖДЕНИЕ','Лист решений','Десять развилок, от которых зависит объём v1', approve_body, nxt()))

html = '''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>WORKFLO W · Менеджер секретов — план на утверждение</title>
<style>
  @page {{ size: A4; margin: 0; }}
  :root {{
    --ink:#1c2126; --ink-2:#4a5560; --ink-3:#8a95a0; --paper:#f6f7f5; --card:#fff;
    --line:#dde3e0; --accent:#1e9e63; --accent-dim:#e3f3ea; --dark:#101410;
    --warn:#b0682a; --warn-bg:#f7efe4; --stop:#a8433a; --stop-bg:#f7e8e6;
    --mono:'IBM Plex Mono','Consolas',monospace; --sans:'IBM Plex Sans','Segoe UI',system-ui,sans-serif;
  }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ background:var(--paper); }}
  body {{ font-family:var(--sans); color:var(--ink); font-size:10.5px; line-height:1.5; }}
  .page {{ width:210mm; height:297mm; padding:16mm 16mm 22mm; position:relative; background:var(--paper); page-break-after:always; overflow:hidden; }}
  .page.dark {{ background:var(--dark); color:#e8ede9; display:flex; flex-direction:column; justify-content:space-between; }}
  .cover .brand {{ font-family:var(--mono); font-size:15px; letter-spacing:.3em; color:#e8ede9; }}
  .cover .brand b {{ color:var(--accent); font-weight:600; }}
  .cover .sub {{ font-family:var(--mono); font-size:9px; letter-spacing:.35em; color:#7d8a80; text-transform:uppercase; margin-top:6px; }}
  .cover h1 {{ font-size:44px; line-height:1.1; font-weight:600; letter-spacing:-0.02em; margin-top:70px; color:#f2f5f0; }}
  .cover h1 .g {{ color:var(--accent); }}
  .cover .lede {{ margin-top:22px; font-size:13px; line-height:1.65; color:#a9b5ab; max-width:140mm; }}
  .cover-meta {{ display:flex; gap:28px; border-top:1px solid #232b24; padding-top:16px; }}
  .cover-meta div {{ font-family:var(--mono); font-size:9px; color:#7d8a80; letter-spacing:.12em; }}
  .cover-meta b {{ display:block; color:#dfe6df; font-size:11px; letter-spacing:.06em; margin-bottom:4px; }}
  .kicker {{ font-family:var(--mono); font-size:8.5px; letter-spacing:.3em; text-transform:uppercase; color:var(--accent); margin-bottom:6px; }}
  h2 {{ font-size:21px; font-weight:600; letter-spacing:-0.01em; margin-bottom:4px; }}
  .h-sub {{ color:var(--ink-3); font-size:10.5px; margin-bottom:12px; }}
  h3 {{ font-size:12.5px; font-weight:600; margin:12px 0 5px; }}
  p {{ margin-bottom:7px; }}
  .footer {{ position:absolute; bottom:9mm; left:16mm; right:16mm; display:flex; justify-content:space-between; font-family:var(--mono); font-size:7.5px; color:var(--ink-3); letter-spacing:.18em; text-transform:uppercase; border-top:1px solid var(--line); padding-top:6px; }}
  .cols {{ display:flex; gap:10px; }}
  .col {{ flex:1; }}
  .stat {{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:10px 12px; }}
  .stat .n {{ font-family:var(--mono); font-size:24px; font-weight:600; color:var(--accent); letter-spacing:-0.02em; }}
  .stat .l {{ font-family:var(--mono); font-size:7.5px; text-transform:uppercase; letter-spacing:.2em; color:var(--ink-3); margin-top:3px; }}
  .callout {{ border:1px solid var(--line); border-left:2px solid var(--accent); background:var(--card); border-radius:0 3px 3px 0; padding:9px 12px; margin:10px 0; font-size:10.5px; }}
  .callout.warn {{ border-left-color:var(--warn); background:var(--warn-bg); }}
  .callout b.t {{ font-family:var(--mono); font-size:8.5px; text-transform:uppercase; letter-spacing:.18em; display:block; margin-bottom:4px; }}
  table {{ width:100%; border-collapse:collapse; margin:8px 0; }}
  th {{ font-family:var(--mono); font-size:7.5px; text-transform:uppercase; letter-spacing:.16em; color:var(--ink-3); text-align:left; padding:5px 7px; border-bottom:1px solid var(--ink); }}
  td {{ padding:5px 7px; border-bottom:1px solid var(--line); vertical-align:top; font-size:9.5px; }}
  td.num {{ font-family:var(--mono); color:var(--ink-3); font-size:8.5px; white-space:nowrap; }}
  td.item b {{ font-weight:600; }}
  td.item .d, .d {{ color:var(--ink-3); font-size:8.5px; }}
  .tag {{ display:inline-block; font-family:var(--mono); font-size:7px; letter-spacing:.12em; padding:2px 6px; border-radius:2px; white-space:nowrap; font-weight:600; }}
  .t-take {{ background:var(--accent-dim); color:#146c45; }}
  .t-build {{ background:#e8eef7; color:#2c5a9e; }}
  .t-rethink {{ background:var(--warn-bg); color:var(--warn); }}
  .t-cut {{ background:var(--stop-bg); color:var(--stop); }}
  .t-mine {{ background:#eef0e6; color:#5c7a1f; }}
  .approve {{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:12px 14px; margin:8px 0; }}
  .approve .q {{ display:flex; gap:10px; align-items:flex-start; padding:7px 0; border-bottom:1px solid var(--line); }}
  .approve .q:last-child {{ border-bottom:none; }}
  .box {{ width:11px; height:11px; border:1.5px solid var(--ink-2); border-radius:2px; flex:0 0 auto; margin-top:2px; }}
  .approve .qt {{ font-weight:600; font-size:10.5px; }}
  .approve .qd {{ color:var(--ink-2); font-size:9px; margin-top:1px; }}
  .side-map {{ display:flex; gap:12px; align-items:stretch; margin:10px 0; }}
  .sm-side {{ width:70mm; flex:0 0 auto; background:var(--card); border:1px solid var(--line); border-radius:4px; overflow:hidden; }}
  .sm-head {{ font-family:var(--mono); font-size:7.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); padding:8px 10px 6px; border-bottom:1px solid var(--line); background:#fbfcfb; display:flex; justify-content:space-between; }}
  .sm-row {{ display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--line); font-size:9.5px; }}
  .sm-row:last-child {{ border-bottom:none; }}
  .sm-row b {{ font-weight:600; }}
  .sm-ic {{ width:16px; height:16px; border:1px solid var(--line); border-radius:3px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:7px; color:var(--ink-3); }}
  .sm-ic.acc {{ border-color:var(--accent); color:var(--accent); background:var(--accent-dim); font-weight:600; }}
  .sm-row.dim {{ color:var(--ink-3); }}
  .sm-sec {{ font-family:var(--mono); font-size:7px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-3); }}
  .sm-sec.acc {{ color:var(--accent); }}
  .sm-n {{ margin-left:auto; font-family:var(--mono); font-size:8px; color:var(--ink-3); }}
  .sm-badge {{ margin-left:auto; font-family:var(--mono); font-size:6.5px; letter-spacing:.1em; color:#146c45; background:var(--accent-dim); border:1px solid var(--accent); border-radius:2px; padding:1px 5px; }}
  .sm-right {{ flex:1; }}
  .sm-block {{ background:var(--card); border:1px solid var(--line); border-radius:4px; padding:9px 11px; margin-bottom:9px; }}
  .sm-block h4 {{ font-size:10.5px; font-weight:600; margin:0 0 4px; }}
  .sm-block p {{ font-size:9px; color:var(--ink-2); margin:0; line-height:1.45; }}
  .legend {{ display:flex; gap:16px; font-family:var(--mono); font-size:8px; color:var(--ink-2); margin:2px 0 8px; }}
  .legend i {{ display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:-1px; }}
  .sw-new {{ background:var(--accent-dim); border:1px solid var(--accent); }}
  .sw-old {{ background:var(--card); border:1px solid var(--line); }}
  .sw-fold {{ background:var(--paper); border:1px dashed var(--ink-3); }}
  .rules {{ list-style:none; margin:6px 0; }}
  .rules li {{ margin:0 0 6px; padding-left:16px; position:relative; font-size:10px; }}
  .rules li::before {{ content:'—'; position:absolute; left:0; color:var(--accent); font-family:var(--mono); }}
  .signature {{ margin-top:16px; display:flex; gap:30px; font-family:var(--mono); font-size:8.5px; color:var(--ink-3); }}
  .signature div {{ flex:1; border-top:1px solid var(--ink-2); padding-top:5px; letter-spacing:.1em; }}
</style>
</head>
<body>

<div class="page dark cover">
  <div>
    <div class="brand">WORKFLO<b>W</b></div>
    <div class="sub">local ai vault · план модуля</div>
  </div>
  <div>
    <h1>Менеджер<br>секретов<br><span class="g">— анализ и решение</span></h1>
    <p class="lede">Полный gap-анализ: 52 пункта плана против реального кода vault-core-arch.
    Что уже построено, что достраивается, что строится с нуля — и что я предлагаю не делать.
    Заканчивается листом утверждения: отметь решения — уйдут в ТЗ для Claude Opus&nbsp;5.</p>
  </div>
  <div class="cover-meta">
    <div><b>ДОКУМЕНТ</b>SECRETS-VAULT · ТЗ v1</div>
    <div><b>ДАТА</b>{DATE}</div>
    <div><b>БАЗА КОДА</b>vault-core-arch</div>
    <div><b>СТАТУС</b>на утверждение</div>
  </div>
</div>

{PAGES}
</body>
</html>'''

full = html.format(DATE=DATE, PAGES='\n'.join(pages))
with open(r'C:\Users\admin-pc\Desktop\HERMES\secrets-vault-plan\report.html', 'w', encoding='utf-8') as f:
    f.write(full)
print('OK, pages:', n, 'chars:', len(full))
