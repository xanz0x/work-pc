/**
 * Окружение unit-тестов: node без DOM. Крипто-ядро и слой хранилища
 * ожидают localStorage и IndexedDB — подкладываем минимальные реализации
 * (fake-indexeddb для базы, Map для localStorage).
 */
import 'fake-indexeddb/auto'

class MemoryStorage {
  private m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

const g = globalThis as unknown as Record<string, unknown>
if (!g.localStorage) g.localStorage = new MemoryStorage()
