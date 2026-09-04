/* ============================================================
   ПОЧТА · встроенная таблица провайдеров
   Хосты/порты и — главное — особые требования к паролю. Диалог
   показывает подсказку ДО ввода пароля, а не после ошибки «неверный пароль».
   Чистые данные и функции без node-зависимостей: их делят сервер,
   клиент и тесты.
   ============================================================ */

export type Security = 'ssl' | 'starttls' | 'none'
export type Endpoint = { host: string; port: number; security: Security }
export type MailConfig = { smtp: Endpoint; imap: Endpoint | null }

export type AuthHintKind = 'plain' | 'app-password' | 'oauth' | 'bridge'
export type AuthHint = {
  kind: AuthHintKind
  title: string
  text: string
  url?: string
  urlLabel?: string
}

export type Provider = {
  id: string
  name: string
  /** Точные домены или шаблон «hotmail.*». */
  domains: string[]
  /** Суффиксы MX-хостов: свой домен на этом провайдере получает те же настройки. */
  mx: string[]
  config: MailConfig
  hint: AuthHint
}

export const PLAIN_HINT: AuthHint = {
  kind: 'plain',
  title: 'Обычный пароль от ящика',
  text: 'Подойдёт пароль, которым вы входите в веб-почту. Если у провайдера включена двухфакторная защита — понадобится пароль приложения.',
}

const ssl = (host: string, port: number): Endpoint => ({ host, port, security: 'ssl' })
const starttls = (host: string, port: number): Endpoint => ({ host, port, security: 'starttls' })

export const PROVIDERS: Provider[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    mx: ['google.com', 'googlemail.com'],
    config: { smtp: ssl('smtp.gmail.com', 465), imap: ssl('imap.gmail.com', 993) },
    hint: {
      kind: 'app-password',
      title: 'Gmail принимает только пароль приложения',
      text: 'Обычный пароль Google не сработает. Включите двухэтапную аутентификацию и создайте пароль приложения (16 символов) — его и вводите ниже.',
      url: 'https://myaccount.google.com/apppasswords',
      urlLabel: 'Создать пароль приложения',
    },
  },
  {
    id: 'yandex',
    name: 'Яндекс',
    domains: ['yandex.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'yandex.ua', 'ya.ru', 'narod.ru', 'yandex.net'],
    mx: ['yandex.net', 'yandex.ru'],
    config: { smtp: ssl('smtp.yandex.ru', 465), imap: ssl('imap.yandex.ru', 993) },
    hint: {
      kind: 'app-password',
      title: 'Яндекс: нужен пароль приложения и включённый IMAP',
      text: 'В настройках Яндекс ID создайте пароль приложения «Почта», а в настройках почты включите доступ по IMAP («Почтовые программы»).',
      url: 'https://id.yandex.ru/security/app-passwords',
      urlLabel: 'Пароли приложений Яндекс ID',
    },
  },
  {
    id: 'mailru',
    name: 'Mail.ru',
    domains: ['mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'internet.ru'],
    mx: ['mail.ru'],
    config: { smtp: ssl('smtp.mail.ru', 465), imap: ssl('imap.mail.ru', 993) },
    hint: {
      kind: 'app-password',
      title: 'Mail.ru: пароль для внешних приложений',
      text: 'Обычный пароль не подойдёт. В разделе «Безопасность» Mail ID создайте пароль для внешнего приложения.',
      url: 'https://id.mail.ru/security',
      urlLabel: 'Открыть Mail ID · Безопасность',
    },
  },
  {
    id: 'outlook',
    name: 'Outlook / Hotmail',
    domains: ['outlook.com', 'outlook.*', 'hotmail.com', 'hotmail.*', 'live.com', 'live.*', 'msn.com'],
    mx: ['outlook.com', 'protection.outlook.com', 'hotmail.com'],
    config: { smtp: starttls('smtp-mail.outlook.com', 587), imap: ssl('outlook.office365.com', 993) },
    hint: {
      kind: 'oauth',
      title: 'Outlook: требуется вход через Microsoft (OAuth2)',
      text: 'Microsoft отключил вход по паролю в IMAP/SMTP для личных ящиков. Вход через Microsoft появится в следующей версии модуля — пока этот ящик подключить нельзя.',
      url: 'https://support.microsoft.com/office/basic-authentication-deprecation',
      urlLabel: 'Подробнее у Microsoft',
    },
  },
  {
    id: 'icloud',
    name: 'iCloud',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    mx: ['icloud.com'],
    config: { smtp: starttls('smtp.mail.me.com', 587), imap: ssl('imap.mail.me.com', 993) },
    hint: {
      kind: 'app-password',
      title: 'iCloud: пароль для приложения',
      text: 'На странице Apple ID → «Вход и безопасность» → «Пароли приложений» создайте пароль и введите его вместо основного.',
      url: 'https://account.apple.com/account/manage',
      urlLabel: 'Открыть Apple ID',
    },
  },
  {
    id: 'yahoo',
    name: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.*', 'ymail.com', 'rocketmail.com', 'aol.com'],
    mx: ['yahoodns.net', 'yahoo.com', 'aol.com'],
    config: { smtp: ssl('smtp.mail.yahoo.com', 465), imap: ssl('imap.mail.yahoo.com', 993) },
    hint: {
      kind: 'app-password',
      title: 'Yahoo: пароль приложения',
      text: 'В настройках безопасности аккаунта Yahoo сгенерируйте пароль приложения — обычный пароль почтовые программы не принимают.',
      url: 'https://login.yahoo.com/account/security',
      urlLabel: 'Безопасность аккаунта Yahoo',
    },
  },
  {
    id: 'proton',
    name: 'Proton Mail',
    domains: ['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me'],
    mx: ['protonmail.ch', 'proton.me'],
    config: { smtp: starttls('127.0.0.1', 1025), imap: starttls('127.0.0.1', 1143) },
    hint: {
      kind: 'bridge',
      title: 'Proton работает только через Proton Bridge',
      text: 'У Proton нет публичного IMAP/SMTP. Установите Proton Bridge на этот компьютер, войдите в него и используйте пароль, который выдал Bridge (не пароль аккаунта). Сервер приложения должен работать на той же машине, что и Bridge.',
      url: 'https://proton.me/mail/bridge',
      urlLabel: 'Скачать Proton Bridge',
    },
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    domains: ['zoho.com', 'zohomail.com', 'zoho.eu', 'zohomail.eu', 'zoho.in'],
    mx: ['zoho.com', 'zoho.eu', 'zoho.in'],
    config: { smtp: ssl('smtp.zoho.com', 465), imap: ssl('imap.zoho.com', 993) },
    hint: {
      kind: 'app-password',
      title: 'Zoho: пароль приложения при включённой 2FA',
      text: 'Если у аккаунта включена двухфакторная защита — создайте Application-Specific Password. Также включите IMAP в настройках почты.',
      url: 'https://accounts.zoho.com/home#security/security_pwd',
      urlLabel: 'Пароли приложений Zoho',
    },
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    domains: ['fastmail.com', 'fastmail.fm', 'fastmail.*'],
    mx: ['messagingengine.com'],
    config: { smtp: ssl('smtp.fastmail.com', 465), imap: ssl('imap.fastmail.com', 993) },
    hint: {
      kind: 'app-password',
      title: 'Fastmail: пароль приложения',
      text: 'Fastmail не принимает основной пароль в почтовых программах: создайте пароль приложения в Settings → Privacy & Security → Integrations.',
      url: 'https://app.fastmail.com/settings/security/devices',
      urlLabel: 'Пароли приложений Fastmail',
    },
  },
  {
    id: 'gmx-com',
    name: 'GMX',
    domains: ['gmx.com', 'gmx.us', 'gmx.co.uk', 'gmx.fr', 'gmx.es', 'gmx.it'],
    mx: ['gmx.com'],
    config: { smtp: ssl('mail.gmx.com', 465), imap: ssl('imap.gmx.com', 993) },
    hint: {
      kind: 'plain',
      title: 'GMX: включите IMAP в настройках',
      text: 'Пароль — обычный. В веб-почте GMX откройте E-Mail → Settings → POP3 & IMAP и включите доступ для внешних программ.',
    },
  },
  {
    id: 'gmx',
    name: 'GMX',
    domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'],
    mx: ['gmx.net'],
    config: { smtp: ssl('mail.gmx.net', 465), imap: ssl('imap.gmx.net', 993) },
    hint: {
      kind: 'plain',
      title: 'GMX: включите IMAP в настройках',
      text: 'Пароль — обычный. В веб-почте GMX откройте E-Mail → Einstellungen → POP3/IMAP Abruf и включите доступ.',
    },
  },
  {
    id: 'rambler',
    name: 'Рамблер',
    domains: ['rambler.ru', 'lenta.ru', 'autorambler.ru', 'myrambler.ru', 'ro.ru', 'rambler.ua'],
    mx: ['rambler.ru'],
    config: { smtp: ssl('smtp.rambler.ru', 465), imap: ssl('imap.rambler.ru', 993) },
    hint: {
      kind: 'plain',
      title: 'Рамблер: включите доступ почтовых программ',
      text: 'Пароль — обычный. В настройках Рамблер/почты включите «Доступ к почте с помощью почтовых клиентов».',
    },
  },
]

export function matchesDomain(pattern: string, domain: string): boolean {
  if (pattern.endsWith('.*')) return domain.startsWith(pattern.slice(0, -1))
  return domain === pattern
}

export function providerByDomain(domain: string): Provider | null {
  const d = domain.toLowerCase()
  return PROVIDERS.find((p) => p.domains.some((pat) => matchesDomain(pat, d))) ?? null
}

/** MX-эвристика: свой домен, почта которого живёт у крупного провайдера. */
export function providerByMx(mxHosts: string[]): Provider | null {
  const hosts = mxHosts.map((h) => h.toLowerCase().replace(/\.$/, ''))
  for (const p of PROVIDERS) {
    if (hosts.some((h) => p.mx.some((sfx) => h === sfx || h.endsWith(`.${sfx}`)))) return p
  }
  return null
}

export function providerName(id: string | null | undefined): string {
  if (!id) return 'Свой сервер'
  return PROVIDERS.find((p) => p.id === id)?.name ?? 'Свой сервер'
}

export const SECURITY_LABEL: Record<Security, string> = { ssl: 'SSL/TLS', starttls: 'STARTTLS', none: 'без шифрования' }

export function endpointLabel(e: Endpoint | null): string {
  if (!e) return '—'
  return `${e.host}:${e.port}`
}
