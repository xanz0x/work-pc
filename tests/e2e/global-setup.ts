import { mkdirSync, writeFileSync } from 'node:fs'
import { request, type FullConfig } from '@playwright/test'

export const ADMIN_STATE = 'test-results/.auth/admin.json'

/**
 * Приложение теперь под учётными записями: сценарии, которые заходят на «/»
 * напрямую, получают cookie администратора отсюда. Сценарии про вход и про
 * второго пользователя открывают свои контексты и логинятся сами.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = (config.projects[0]?.use.baseURL as string | undefined) ?? 'http://localhost:3000'
  const password = process.env.APP_PASSWORD
  mkdirSync('test-results/.auth', { recursive: true })
  if (!password) {
    writeFileSync(ADMIN_STATE, JSON.stringify({ cookies: [], origins: [] }))
    return
  }
  const ctx = await request.newContext({ baseURL })
  const r = await ctx.post('/ai-api/auth/login', { data: { login: 'admin', password } })
  if (!r.ok()) throw new Error(`вход администратора не удался: HTTP ${r.status()}`)
  await ctx.storageState({ path: ADMIN_STATE })
  await ctx.dispose()
}
