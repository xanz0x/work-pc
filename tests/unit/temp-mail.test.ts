import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { extractActionLink, extractCode, subjectCode } from '@/lib/mail-format'
import { mtRows, sortRows, spRows } from '@/lib/temp-mail-parse'

describe('временная почта · разбор ответов провайдеров', () => {
  const mtMsg = { id: 'abc123', subject: 'Код входа', from: { address: 'noreply@site.io', name: 'Site' }, createdAt: '2026-06-01T10:00:00+00:00' }

  it('mail.tm: hydra-коллекция', () => {
    expect(mtRows({ 'hydra:member': [mtMsg] })).toEqual([{ mid: 'abc123', subject: 'Код входа', from: 'Site', date: '2026-06-01T10:00:00.000Z' }])
  })

  it('mail.tm: плоский массив (Accept: application/json)', () => {
    expect(mtRows([mtMsg])[0].mid).toBe('abc123')
  })

  it('mail.tm: без имени отправителя берётся адрес, мусор не роняет разбор', () => {
    expect(mtRows([{ id: 'x', from: { address: 'a@b.io' } }])[0]).toEqual({ mid: 'x', subject: '', from: 'a@b.io', date: null })
    expect(mtRows(null)).toEqual([])
    expect(mtRows({ messages: [] })).toEqual([])
  })

  it('SmailPro: {messages:[…]}', () => {
    const rows = spRows({ messages: [{ mid: 'm1', textSubject: 'Hello', textFrom: 'GitHub', textDate: '2026-05-30T10:15:00Z' }] })
    expect(rows).toEqual([{ mid: 'm1', subject: 'Hello', from: 'GitHub', date: '2026-05-30T10:15:00.000Z' }])
    expect(spRows(null)).toEqual([])
  })

  it('новые письма оказываются сверху', () => {
    const rows = sortRows([
      { mid: 'a', subject: '', from: '', date: '2026-06-01T10:00:00.000Z' },
      { mid: 'b', subject: '', from: '', date: '2026-06-02T10:00:00.000Z' },
      { mid: 'c', subject: '', from: '', date: null },
    ])
    expect(rows.map((r) => r.mid)).toEqual(['b', 'a', 'c'])
  })
})

describe('временная почта · код подтверждения', () => {
  it('берёт код рядом со словом «код»', () => {
    expect(extractCode(null, 'Ваш код подтверждения: 483920. Никому его не сообщайте.')).toBe('483920')
  })

  it('понимает англоязычные письма и HTML', () => {
    expect(extractCode('<p>Your verification <b>code</b> is <strong>91 234</strong></p>', null)).toBe(null)
    expect(extractCode('<p>Your verification code is <strong>912345</strong></p>', null)).toBe('912345')
  })

  it('берёт буквенно-цифровой код', () => {
    expect(extractCode(null, 'Code: A1B2C3')).toBe('A1B2C3')
  })

  it('без слов про код кода НЕ придумывает', () => {
    /* Письмо-подтверждение без кода: раньше бралось первое же число. */
    expect(extractCode(null, 'Подтвердите вход по ссылке ниже. Ссылка живёт 24 часа.')).toBe(null)
    expect(
      extractCode(
        '<p>Hey, thanks for signing up.</p><a href="https://x.dev/confirm?t=1">Confirm Email</a><p>Emergent, 100 Pine St, San Francisco, CA 94111</p>',
        null,
      ),
    ).toBe(null)
    expect(extractCode(null, 'Ваш заказ 483920 отправлен со склада')).toBe(null)
  })

  it('тема про код разрешает одиночное число в теле', () => {
    expect(extractCode('<p>Введите это число: <b>483920</b></p>', null, 'Ваш код для входа')).toBe('483920')
    expect(extractCode('<p>Введите это число: <b>483920</b></p>', null, 'Добро пожаловать')).toBe(null)
  })

  it('игнорирует даты, суммы, годы и адреса ссылок', () => {
    expect(extractCode(null, 'Счёт на 1 200,50 от 12.03.2026')).toBe(null)
    expect(extractCode(null, 'Код внутри ссылки https://t.co/abcd123456 не считается')).toBe(null)
    expect(extractCode(null, 'Ваш код: 483920 — действует 10 минут')).toBe('483920')
  })

  it('не путает код с частью hex-строки или слова', () => {
    expect(subjectCode('TEST_QA verification c6040a')).toBe(null)
    expect(extractCode(null, 'verification c6040a')).toBe(null)
    expect(subjectCode('317884 is your Vercel sign up code')).toBe('317884')
    expect(subjectCode('Заказ 12345 отправлен')).toBe(null)
  })

  it('пустое письмо — без кода', () => {
    expect(extractCode(null, null)).toBe(null)
    expect(extractCode('<div><style>.a{color:#123456}</style>Привет</div>', null)).toBe(null)
  })
})

describe('почта · ссылка-кнопка из письма', () => {
  it('находит кнопку подтверждения', () => {
    const html =
      '<table><tr><td bgcolor="#1f6feb"><a href="https://smld.awstrack.me/L0/https:%2F%2Fapp.dev%2Fconfirm" style="background:#1f6feb;border-radius:24px">Confirm Email &rarr;</a></td></tr></table>' +
      '<p><a href="https://app.dev/unsubscribe">Unsubscribe</a></p>'
    const link = extractActionLink(html, null)
    expect(link?.url).toBe('https://smld.awstrack.me/L0/https:%2F%2Fapp.dev%2Fconfirm')
    expect(link?.label).toContain('Confirm Email')
  })

  it('понимает русскую кнопку и не берёт служебные ссылки', () => {
    const html =
      '<a href="https://site.ru/privacy">Политика конфиденциальности</a>' +
      '<a href="https://site.ru/v/abc" class="btn">Подтвердить почту</a>' +
      '<a href="https://site.ru/unsub">Отписаться</a>'
    expect(extractActionLink(html, null)?.url).toBe('https://site.ru/v/abc')
  })

  it('в письме без кнопки ссылки не выдумывает', () => {
    expect(extractActionLink('<p>Привет! Просто письмо <a href="https://site.ru/blog">блог</a></p>', null)).toBe(null)
    expect(extractActionLink(null, 'Обычное письмо без ссылок')).toBe(null)
  })

  it('берёт единственную ссылку из текстового письма со словами действия', () => {
    expect(extractActionLink(null, 'Подтвердите адрес: https://site.ru/confirm/abc')?.url).toBe('https://site.ru/confirm/abc')
  })
})

/* ============================================================
   MAIL.TM · полный поток (P5): fixture-ответы api.mail.tm, живая
   логика модуля. fetch подменён, requireUser/userDir — моки,
   temp.json пишется во временную папку и проверяется изнутри.
   ============================================================ */

/* vi.hoisted: объект должен существовать до загрузки мокируемых модулей. */
const io = vi.hoisted(() => ({ dir: '' }))

vi.mock('@/lib/request-context', () => ({
  requireUser: () => ({ uid: 'tester', legacy: false }),
}))

vi.mock('@/lib/users-server', () => ({
  userDir: () => io.dir,
}))

process.env.MAIL_SECRET = 'wsx-unit-test-mail-secret-0123456789'

import { createTempBox, TempError, tempInbox } from '@/lib/temp-mail'
import { decryptSecret } from '@/lib/mail-crypto'

const MT = 'https://api.mail.tm'

type Call = { url: string; method: string; headers: Record<string, string> }
let calls: Call[] = []
let route: (url: string, init?: RequestInit) => Response = () => new Response('{}', { status: 500 })

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

beforeEach(() => {
  io.dir = mkdtempSync(path.join(tmpdir(), 'wsx-temp-mail-'))
  calls = []
  route = () => jsonResponse(500, {})
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> })
    return route(u, init)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (io.dir) rmSync(io.dir, { recursive: true, force: true })
})

/* Стандартные fixture-ответы: домен → создание аккаунта → выдача токена. */
const mtFixtures = () => {
  route = (u, init) => {
    if (u === `${MT}/domains`) return jsonResponse(200, { 'hydra:member': [{ domain: 'somoj.com', isActive: true }] })
    if (u === `${MT}/accounts` && init?.method === 'POST') return jsonResponse(201, { id: 'acc-1' })
    if (u === `${MT}/token`) return jsonResponse(200, { id: 'acc-1', token: 'tok-1' })
    return jsonResponse(500, {})
  }
}

type CatalogRow = { address: string; accountId?: string; secretEnc: string }
const readCatalog = (): CatalogRow[] => JSON.parse(readFileSync(path.join(io.dir, 'mail', 'temp.json'), 'utf8')) as CatalogRow[]
const catalogExists = (): boolean => existsSync(path.join(io.dir, 'mail', 'temp.json'))

describe('mail.tm · создание ящика (P5)', () => {
  it('адрес создаётся, пароль и токен сохраняются зашифрованными, наружу не утекают', async () => {
    mtFixtures()
    const view = await createTempBox('mailtm')
    expect(view.address.endsWith('@somoj.com')).toBe(true)
    expect(view.lastSyncAt).toBeNull()
    expect(view).not.toHaveProperty('secretEnc')
    expect(view).not.toHaveProperty('accountId')

    const catalog = readCatalog()
    expect(catalog).toHaveLength(1)
    expect(catalog[0].accountId).toBe('acc-1')
    const saved = JSON.parse(decryptSecret(catalog[0].secretEnc)) as { password: string; token: string }
    expect(saved.token).toBe('tok-1')
    expect(saved.password.length).toBeGreaterThanOrEqual(6)
  }, 15_000)

  it('логин сразу после создания повторяется при 401: аккаунт ещё не активен', async () => {
    let tokenCalls = 0
    route = (u, init) => {
      if (u === `${MT}/domains`) return jsonResponse(200, { 'hydra:member': [{ domain: 'somoj.com', isActive: true }] })
      if (u === `${MT}/accounts` && init?.method === 'POST') return jsonResponse(201, { id: 'acc-2' })
      if (u === `${MT}/token`) {
        tokenCalls += 1
        return tokenCalls <= 2 ? jsonResponse(401, { message: 'not active yet' }) : jsonResponse(200, { token: 'tok-3' })
      }
      return jsonResponse(500, {})
    }
    await createTempBox('mailtm')
    expect(tokenCalls).toBe(3)
    const saved = JSON.parse(decryptSecret(readCatalog()[0].secretEnc)) as { token: string }
    expect(saved.token).toBe('tok-3')
  }, 15_000)

  it('логин так и не удался: человеческая ошибка с кодом, ящик не сохраняется', async () => {
    route = (u, init) => {
      if (u === `${MT}/domains`) return jsonResponse(200, { 'hydra:member': [{ domain: 'somoj.com', isActive: true }] })
      if (u === `${MT}/accounts` && init?.method === 'POST') return jsonResponse(201, { id: 'acc-3' })
      if (u === `${MT}/token`) return jsonResponse(401, { message: 'wrong password' })
      return jsonResponse(500, {})
    }
    const err = (await createTempBox('mailtm').catch((e: unknown) => e)) as TempError
    expect(err).toBeInstanceOf(TempError)
    expect(err.code).toBe('PROVIDER')
    expect(err.message).toContain('401')
    expect(catalogExists()).toBe(false)
  }, 15_000)

  it('жёсткий лимит mail.tm при логине: RATE_LIMITED с retryAfter, без выжигания попыток', async () => {
    let tokenCalls = 0
    route = (u, init) => {
      if (u === `${MT}/domains`) return jsonResponse(200, { 'hydra:member': [{ domain: 'somoj.com', isActive: true }] })
      if (u === `${MT}/accounts` && init?.method === 'POST') return jsonResponse(201, { id: 'acc-4' })
      if (u === `${MT}/token`) {
        tokenCalls += 1
        return jsonResponse(429, { message: 'slow down' }, { 'retry-after': '9' })
      }
      return jsonResponse(500, {})
    }
    const err = (await createTempBox('mailtm').catch((e: unknown) => e)) as TempError
    expect(err).toBeInstanceOf(TempError)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.retryAfter).toBe(9)
    expect(tokenCalls).toBe(1)
  }, 15_000)
})

describe('mail.tm · чтение писем (P5)', () => {
  it('сообщения запрашиваются под сохранённым токеном (Bearer)', async () => {
    mtFixtures()
    const view = await createTempBox('mailtm')
    route = (u) => {
      if (u === `${MT}/messages`)
        return jsonResponse(200, {
          'hydra:member': [{ id: 'm1', subject: 'Код входа', from: { address: 'noreply@site.io', name: 'Site' }, createdAt: '2026-09-01T10:00:00+00:00' }],
        })
      return jsonResponse(500, {})
    }
    const { rows } = await tempInbox(view.id)
    expect(rows).toEqual([{ mid: 'm1', subject: 'Код входа', from: 'Site', date: '2026-09-01T10:00:00.000Z' }])
    const messages = calls.find((c) => c.url === `${MT}/messages`)
    expect(messages?.headers.Authorization).toBe('Bearer tok-1')
  }, 15_000)

  it('429 на чтении превращается в RATE_LIMITED с retryAfter из заголовка', async () => {
    mtFixtures()
    const view = await createTempBox('mailtm')
    route = (u) => (u === `${MT}/messages` ? jsonResponse(429, { message: 'rate limited' }, { 'retry-after': '7' }) : jsonResponse(500, {}))
    const err = (await tempInbox(view.id).catch((e: unknown) => e)) as TempError
    expect(err).toBeInstanceOf(TempError)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.retryAfter).toBe(7)
  }, 15_000)

  it('токен протух: перевход по сохранённому паролю, свежий токен шифруется обратно', async () => {
    mtFixtures()
    const view = await createTempBox('mailtm')
    let messageCalls = 0
    route = (u) => {
      if (u === `${MT}/token`) return jsonResponse(200, { token: 'tok-fresh' })
      if (u === `${MT}/messages`) {
        messageCalls += 1
        return messageCalls === 1
          ? jsonResponse(401, {})
          : jsonResponse(200, { 'hydra:member': [{ id: 'm2', subject: 'Ещё код', from: { address: 'a@b.io' } }] })
      }
      return jsonResponse(500, {})
    }
    const { rows } = await tempInbox(view.id)
    expect(messageCalls).toBe(2)
    expect(rows[0].mid).toBe('m2')
    const saved = JSON.parse(decryptSecret(readCatalog()[0].secretEnc)) as { token: string }
    expect(saved.token).toBe('tok-fresh')
  }, 15_000)

  it('ящик создан под другим MAIL_SECRET: честный NOT_SUPPORTED', async () => {
    mtFixtures()
    const view = await createTempBox('mailtm')
    const prev = process.env.MAIL_SECRET
    process.env.MAIL_SECRET = 'wsx-unit-test-mail-secret-совсем-другой'
    try {
      const err = (await tempInbox(view.id).catch((e: unknown) => e)) as TempError
      expect(err).toBeInstanceOf(TempError)
      expect(err.code).toBe('NOT_SUPPORTED')
      expect(err.message).toContain('MAIL_SECRET')
    } finally {
      process.env.MAIL_SECRET = prev
    }
  }, 15_000)
})
