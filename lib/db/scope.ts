/* ============================================================
   ОБЛАСТЬ ЛОКАЛЬНОГО ХРАНИЛИЩА · один браузер, несколько аккаунтов
   Каждый пользователь получает свою базу IndexedDB и свой префикс в
   localStorage: два человека за одним компьютером не видят данные друг
   друга. Первый (мигрированный) админ остаётся на старых именах — его
   архив не переезжает. Область ставится до первого чтения сторов
   (см. AccountGate) и не меняется до перезагрузки страницы.
   ============================================================ */

import { DB_NAME } from './schema'

let uid: string | null = null
let legacy = true
let installed = false

export function dbName(): string {
  return legacy || !uid ? DB_NAME : `${DB_NAME}-${uid}`
}

export function storageScope(): { uid: string | null; legacy: boolean } {
  return { uid, legacy }
}

/** Storage поверх настоящего localStorage: все ключи под префиксом пользователя. */
class ScopedStorage implements Storage {
  constructor(
    private readonly real: Storage,
    private readonly prefix: string,
  ) {}
  private own(): string[] {
    const out: string[] = []
    for (let i = 0; i < this.real.length; i += 1) {
      const k = this.real.key(i)
      if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length))
    }
    return out
  }
  get length(): number {
    return this.own().length
  }
  key(i: number): string | null {
    return this.own()[i] ?? null
  }
  getItem(k: string): string | null {
    return this.real.getItem(this.prefix + k)
  }
  setItem(k: string, v: string): void {
    this.real.setItem(this.prefix + k, v)
  }
  removeItem(k: string): void {
    this.real.removeItem(this.prefix + k)
  }
  clear(): void {
    for (const k of this.own()) this.real.removeItem(this.prefix + k)
  }
}

/**
 * Установить область для пользователя. Для legacy-админа ничего не меняется.
 * Повторный вызов с другим пользователем — только через перезагрузку:
 * сторы уже прочитали старую область.
 */
export function installStorageScope(user: { id: string; legacyStore: boolean }): void {
  if (installed) return
  installed = true
  uid = user.id
  legacy = user.legacyStore
  if (legacy || typeof window === 'undefined') return
  const real = window.localStorage
  const scoped = new ScopedStorage(real, `u:${user.id}:`)
  Object.defineProperty(window, 'localStorage', { value: scoped, configurable: true })
}

/** Для тестов. */
export function resetStorageScope(): void {
  installed = false
  uid = null
  legacy = true
}
