import { describe, expect, it } from 'vitest'
import { configFromSrv, parseAutodiscover, parseClientConfig, splitEmail } from '@/lib/mail-discovery'
import { PROVIDERS, matchesDomain, providerByDomain, providerByMx } from '@/lib/mail-providers'

const ISPDB = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <domain>example.com</domain>
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname><port>143</port><socketType>STARTTLS</socketType>
      <username>%EMAILLOCALPART%</username><authentication>password-cleartext</authentication>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname><port>993</port><socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="pop3">
      <hostname>pop.example.com</hostname><port>995</port><socketType>SSL</socketType>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.com</hostname><port>587</port><socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

describe('почта · встроенная таблица провайдеров', () => {
  it('знает основные домены и требования к паролю', () => {
    expect(providerByDomain('gmail.com')?.hint.kind).toBe('app-password')
    expect(providerByDomain('proton.me')?.hint.kind).toBe('bridge')
    expect(providerByDomain('proton.me')?.config.smtp.host).toBe('127.0.0.1')
    expect(providerByDomain('hotmail.co.uk')?.hint.kind).toBe('oauth')
    expect(providerByDomain('bk.ru')?.id).toBe('mailru')
    expect(providerByDomain('ya.ru')?.config.imap?.host).toBe('imap.yandex.ru')
    expect(providerByDomain('unknown-domain.io')).toBeNull()
  })

  it('шаблон «hotmail.*» матчит только под-домены с точкой', () => {
    expect(matchesDomain('hotmail.*', 'hotmail.de')).toBe(true)
    expect(matchesDomain('hotmail.*', 'hotmailx.de')).toBe(false)
    expect(matchesDomain('gmail.com', 'gmail.com.evil')).toBe(false)
  })

  it('MX-эвристика: свой домен на Google/Microsoft/Яндекс', () => {
    expect(providerByMx(['aspmx.l.google.com.'])?.id).toBe('gmail')
    expect(providerByMx(['corp-com.mail.protection.outlook.com'])?.id).toBe('outlook')
    expect(providerByMx(['mx.yandex.net'])?.id).toBe('yandex')
    expect(providerByMx(['mail.protonmail.ch'])?.id).toBe('proton')
    expect(providerByMx(['mx1.somehost.example'])).toBeNull()
  })

  it('в таблице только TLS, кроме loopback Bridge', () => {
    for (const p of PROVIDERS) {
      const eps = [p.config.smtp, p.config.imap].filter(Boolean)
      for (const e of eps) {
        if (e!.host === '127.0.0.1') continue
        expect(e!.security, `${p.id} ${e!.host}`).not.toBe('none')
      }
    }
  })
})

describe('почта · парсеры автопоиска', () => {
  it('clientConfig: берёт SSL-IMAP поверх STARTTLS, подставляет логин, игнорирует pop3', () => {
    const r = parseClientConfig(ISPDB, 'ann@example.com')
    expect(r).not.toBeNull()
    expect(r!.config.imap).toEqual({ host: 'imap.example.com', port: 993, security: 'ssl' })
    expect(r!.config.smtp).toEqual({ host: 'smtp.example.com', port: 587, security: 'starttls' })
    expect(r!.user).toBe('ann@example.com')
  })

  it('clientConfig без SMTP — не конфиг', () => {
    expect(parseClientConfig('<clientConfig><incomingServer type="imap"><hostname>x</hostname><port>993</port><socketType>SSL</socketType></incomingServer></clientConfig>', 'a@b.co')).toBeNull()
  })

  it('SRV: предпочитает 465/993, хвостовую точку убирает', () => {
    const cfg = configFromSrv({
      imaps: [{ name: 'imap.corp.example.', port: 993, priority: 0 }],
      imap: [{ name: 'imap.corp.example.', port: 143, priority: 0 }],
      submissions: [],
      submission: [{ name: 'smtp.corp.example.', port: 587, priority: 10 }],
    })
    expect(cfg).toEqual({
      smtp: { host: 'smtp.corp.example', port: 587, security: 'starttls' },
      imap: { host: 'imap.corp.example', port: 993, security: 'ssl' },
    })
    expect(configFromSrv({ imaps: [{ name: 'i', port: 993, priority: 0 }] })).toBeNull()
    expect(configFromSrv({ submission: [{ name: '.', port: 0, priority: 0 }] })).toBeNull()
  })

  it('Autodiscover POX: IMAP + SMTP из блоков Protocol', () => {
    const xml = `<Autodiscover><Response><Account>
      <Protocol><Type>IMAP</Type><Server>imap.corp.example</Server><Port>993</Port><SSL>on</SSL></Protocol>
      <Protocol><Type>SMTP</Type><Server>smtp.corp.example</Server><Port>587</Port><Encryption>TLS</Encryption></Protocol>
    </Account></Response></Autodiscover>`
    expect(parseAutodiscover(xml)).toEqual({
      smtp: { host: 'smtp.corp.example', port: 587, security: 'starttls' },
      imap: { host: 'imap.corp.example', port: 993, security: 'ssl' },
    })
  })

  it('splitEmail валидирует и нормализует адрес', () => {
    expect(splitEmail('  Ann@Example.COM ')).toEqual({ local: 'ann', domain: 'example.com' })
    expect(splitEmail('nope')).toBeNull()
    expect(splitEmail('a@b')).toBeNull()
  })
})
