import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { parse } from 'dotenv'

export const CONFIG_VERSION = 1
export function hostName(value) {
  const host = String(value ?? '').trim().toLowerCase()
  if (!host || host.length > 253 || (!isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host))) throw new Error('Укажите IP-адрес или имя главного компьютера, без https:// и пути.')
  if (isIP(host) === 6) throw new Error('Пока поддерживаются IPv4 и имена компьютеров.')
  return host
}
export function validateHostInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Не заполнены настройки.')
  const login = String(input.login ?? '').trim().toLowerCase()
  const password = String(input.password ?? '')
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) throw new Error('Логин: 3–32 латинские буквы, цифры, точка, дефис или подчёркивание.')
  if (password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) throw new Error('Пароль: от 12 до 128 символов, без перевода строки.')
  if (password !== input.confirmPassword) throw new Error('Пароли не совпадают.')
  const mailKey = String(input.mailKey ?? '').trim()
  if (mailKey && (mailKey.length < 8 || mailKey.length > 4096 || /[\r\n\0]/.test(mailKey))) throw new Error('Проверьте ключ SmailPro.')
  return { login, password, mailKey, host: hostName(input.host) }
}
export function connection(value) {
  if (!value || value.version !== CONFIG_VERSION || typeof value.url !== 'string' || value.url.length > 512) throw new Error('Неверное приглашение. Скопируйте его заново с главного ПК.')
  const url = new URL(value.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Приглашение должно содержать только HTTPS-адрес главного ПК.')
  hostName(url.hostname)
  const pin = String(value.pin ?? '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(pin)) throw new Error('В приглашении отсутствует отпечаток сертификата.')
  return { version: CONFIG_VERSION, url: url.origin, pin }
}
export const encodeInvite = (value) => `WSX1-${Buffer.from(JSON.stringify(connection(value))).toString('base64url')}`
export function decodeInvite(text) {
  if (typeof text !== 'string' || !text.trim().startsWith('WSX1-') || text.length > 2048) throw new Error('Вставьте полный код приглашения WSX1-…')
  try { return connection(JSON.parse(Buffer.from(text.trim().slice(5), 'base64url').toString('utf8'))) }
  catch { throw new Error('Приглашение повреждено или содержит недопустимый адрес.') }
}
export async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, file)
}
export async function loadConfig(root) {
  try { return JSON.parse(await readFile(path.join(root, 'connection.json'), 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return null; throw new Error('Не удалось прочитать настройки. Данные не удалены.') }
}
export async function runtimeEnv(resources, root) {
  const env = parse(await readFile(path.join(resources, 'runtime.env')))
  for (const key of ['WSX_HTTPS_PORT', 'WSX_NEXT_PORT', 'WSX_LOOPBACK', 'WSX_LISTEN_HOST']) {
    if (!env[key]) throw new Error(`В сборке отсутствует ${key}`)
  }
  for (const key of ['WSX_HTTPS_PORT', 'WSX_NEXT_PORT']) {
    if (!/^\d+$/.test(env[key]) || +env[key] < 1024 || +env[key] > 65535) throw new Error(`Некорректный ${key}`)
  }
  if (env.WSX_LOOPBACK !== '127.0.0.1') throw new Error('Приложение должно слушать только локальный адрес.')
  if (env.WSX_HTTPS_PORT === env.WSX_NEXT_PORT) throw new Error('Порты приложения должны различаться.')
  return { ...env, AI_DIR: path.join(root, 'data') }
}
export function newSecrets(input) {
  return { ADMIN_LOGIN: input.login, APP_PASSWORD: input.password, APP_SESSION_SECRET: randomBytes(48).toString('hex'), MAIL_SECRET: randomBytes(48).toString('hex'), ...(input.mailKey ? { SONJJ_API_KEY: input.mailKey } : {}) }
}