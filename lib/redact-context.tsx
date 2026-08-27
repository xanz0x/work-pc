'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/* ============================================================
   REDACT-КОНТЕКСТ (план пп.10.2–10.3)
   Какие объекты сейфа сейчас показывать «Под ключом».

   Второй агент (этап 5) пишет hooks/use-file-keys.ts:
     - кладёт список id объектов под файловым ключом в
       localStorage 'wf.filekeys.lockedlist' (JSON-массив строк);
     - при успешном открытии файла ключом вызывает markUnlocked(id),
       а при блокировке сейфа очищает набор открытий вкладки.
   Пока список не появился — работаем с пустым множеством,
   интерфейс просто ничего не красактит (честный fallback).
   ============================================================ */

/** Список id под файловым ключом; автор этого ключа — этап 5 (см. TODO выше). */
export const FILEKEYS_LOCKEDLIST_KEY = 'wf.filekeys.lockedlist'

type RedactedCtx = {
  /**
   * Объекты, открытые файловым ключом В ЭТОЙ вкладке до конца сессии.
   * Факт открытия живёт только в памяти вкладки (п.10.5).
   */
  unlockedSessionIds: Set<string>
  /** Итоговый красакт: под ключом минус открытые в этой вкладке. */
  redactIds: Set<string>
  /**
   * Зарегистрировать успешное открытие объекта файловым ключом.
   * Точка интеграции этапа 5: use-file-keys вызывает после проверки пароля.
   */
  markUnlocked: (id: string) => void
}

const Ctx = createContext<RedactedCtx | null>(null)

function readLockedList(): string[] {
  try {
    const raw = localStorage.getItem(FILEKEYS_LOCKEDLIST_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

const EMPTY_SET = new Set<string>()

export function RedactedProvider({ children }: { children: ReactNode }) {
  const [lockedList, setLockedList] = useState<string[]>([])
  /** Открытые в этой вкладке — хранится отдельно, мутируется через ref-safe снапшот. */
  const [unlockedSessionIds] = useState<Set<string>>(() => new Set())

  /* Список из localStorage читаем после монтирования (SSR совпадает с пустым),
     потом следим за изменениями из других вкладок. */
  useEffect(() => {
    setLockedList(readLockedList())
    function onStorage(e: StorageEvent) {
      /* e.key === null — wipe всего хранилища: readLockedList() вернёт пусто. */
      if (e.key !== FILEKEYS_LOCKEDLIST_KEY && e.key !== null) return
      setLockedList(readLockedList())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const markUnlocked = useMemo(
    () => (id: string) => {
      unlockedSessionIds.add(id)
    },
    [unlockedSessionIds],
  )

  const value = useMemo<RedactedCtx>(() => {
    const redactIds = new Set(lockedList)
    for (const id of unlockedSessionIds) redactIds.delete(id)
    return { unlockedSessionIds, redactIds, markUnlocked }
  }, [lockedList, unlockedSessionIds, markUnlocked])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Вне провайдера тестов/историй красакт молчит — возвращаем пустое множество,
 * чтобы компоненты не падали и не красактили лишнего.
 */
export function useRedacted(): RedactedCtx {
  const v = useContext(Ctx)
  if (!v) {
    return { unlockedSessionIds: EMPTY_SET, redactIds: EMPTY_SET, markUnlocked: () => {} }
  }
  return v
}
