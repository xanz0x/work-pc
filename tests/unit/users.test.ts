/* Аккаунты: хеш пароля, доступ, лицензии, изоляция каталогов. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accessState, isEmail, passwordProblem } from '@/lib/users'

const dir = mkdtempSync(join(tmpdir(), 'wsx-users-'))
process.env.AI_DIR = dir
process.env.APP_PASSWORD = 'seed-password-1'
process.env.ADMIN_EMAIL = 'root@test.local'

type Srv = typeof import('@/lib/users-server')
let srv: Srv
beforeAll(async () => {
  srv = await import('@/lib/users-server')
  srv.resetUsersState()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('users · чистые правила', () => {
  it('email и пароль проверяются на границе', () => {
    expect(isEmail('a@b.co')).toBe(true)
    expect(isEmail('nope')).toBe(false)
    expect(passwordProblem('short')).toBeTruthy()
    expect(passwordProblem('long-enough-1')).toBeNull()
  })
  it('доступ: блок > пароль > лицензия; админу лицензия не нужна', () => {
    const base = { role: 'user' as const, status: 'active' as const, licenseUntil: null, mustChangePassword: false }
    expect(accessState(base)).toBe('license')
    expect(accessState({ ...base, licenseUntil: Date.now() + 1000 })).toBe('ok')
    expect(accessState({ ...base, licenseUntil: Date.now() - 1 })).toBe('license')
    expect(accessState({ ...base, mustChangePassword: true })).toBe('password')
    expect(accessState({ ...base, status: 'blocked', mustChangePassword: true })).toBe('blocked')
    expect(accessState({ ...base, role: 'admin' })).toBe('ok')
  })
})

describe('users-server', () => {
  it('админ сеется из окружения и входит одним паролем', async () => {
    const r = await srv.login(null, 'seed-password-1', 3_600_000, 'vitest')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.user.role).toBe('admin')
    expect(r.user.legacyStore).toBe(true)
    expect(r.user.email).toBe('root@test.local')
    const s = await srv.resolveSession(r.sid)
    expect(s?.user.id).toBe(r.user.id)
    await srv.endSession(r.sid)
    expect(await srv.resolveSession(r.sid)).toBeNull()
  })

  it('scrypt-хеш не равен паролю и не совпадает для двух пользователей', async () => {
    const a = await srv.hashPassword('same-password-1')
    const b = await srv.hashPassword('same-password-1')
    expect(a).not.toBe(b)
    expect(a).not.toContain('same-password')
    expect(await srv.verifyPassword('same-password-1', a)).toBe(true)
    expect(await srv.verifyPassword('other-password', a)).toBe(false)
  })

  it('регистрация → без лицензии → ключ → доступ; повторный ключ не проходит', async () => {
    const reg = await srv.register('ira@test.local', 'ira-password-1', 'Ира', 3_600_000, 'vitest')
    expect(reg.ok).toBe(true)
    if (!reg.ok) return
    expect(accessState(reg.user)).toBe('license')
    const { key, view } = await srv.issueLicense(30, 'для Иры')
    expect(view.mask.endsWith(key.slice(-4))).toBe(true)
    expect(await srv.redeemLicense(reg.user.id, 'WSX-AAAA-BBBB-CCCC-DDDD')).toBe('INVALID')
    expect(await srv.redeemLicense(reg.user.id, key)).toBe('ok')
    expect(await srv.redeemLicense(reg.user.id, key)).toBe('USED')
    const u = await srv.getUser(reg.user.id)
    expect(u && accessState(u)).toBe('ok')
    expect(await srv.register('ira@test.local', 'x'.repeat(10), '', 1, '')).toEqual({ ok: false, code: 'EMAIL_TAKEN' })
  })

  it('лимит ИИ считается по суткам; 0 — без лимита', async () => {
    const u = (await srv.listUsers()).find((x) => x.role === 'user')!
    await srv.adminPatchUser('actor', u.id, { aiDailyLimit: 2 })
    expect((await srv.countAiCall(u.id)).ok).toBe(true)
    expect((await srv.countAiCall(u.id)).ok).toBe(true)
    expect((await srv.countAiCall(u.id)).ok).toBe(false)
    await srv.adminPatchUser('actor', u.id, { aiDailyLimit: 0 })
    expect((await srv.countAiCall(u.id)).ok).toBe(true)
  })

  it('последнего админа нельзя понизить, себя — заблокировать, первого — удалить', async () => {
    const admin = (await srv.listUsers()).find((x) => x.role === 'admin')!
    expect(await srv.adminPatchUser('other', admin.id, { role: 'user' })).toBe('LAST_ADMIN')
    expect(await srv.adminPatchUser(admin.id, admin.id, { status: 'blocked' })).toBe('SELF')
    expect(await srv.adminDeleteUser('other', admin.id)).toBe('LEGACY')
  })

  it('сброс пароля завершает сессии и требует смены; блокировка — выкидывает', async () => {
    const u = (await srv.listUsers()).find((x) => x.role === 'user')!
    const l = await srv.login(u.email, 'ira-password-1', 3_600_000, '')
    expect(l.ok).toBe(true)
    if (!l.ok) return
    expect(await srv.adminResetPassword(u.id, 'temp-password-1')).toBe(true)
    expect(await srv.resolveSession(l.sid)).toBeNull()
    const l2 = await srv.login(u.email, 'temp-password-1', 3_600_000, '')
    expect(l2.ok && l2.user.mustChangePassword).toBe(true)
    expect(await srv.changePassword(u.id, null, 'final-password-1')).toBe('ok')
    await srv.adminPatchUser('actor', u.id, { status: 'blocked' })
    expect(await srv.login(u.email, 'final-password-1', 1, '')).toEqual({ ok: false, code: 'BLOCKED' })
    expect(await srv.adminDeleteUser('actor', u.id)).toBe('ok')
    expect(await srv.getUser(u.id)).toBeNull()
  })

  it('каталог данных: первый админ — корень AI_DIR, остальные — users/<id>', () => {
    expect(srv.userDir('abc', true)).toBe(dir)
    expect(srv.userDir('abc', false)).toBe(join(dir, 'users', 'abc'))
  })
})
