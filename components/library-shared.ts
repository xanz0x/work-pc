'use client'

/* Общие мелочи экрана библиотеки: мост desktop-приложения и подписи связей.
   Вынесено из screen-library.tsx без изменения поведения. */

import type { EdgeReason } from '@/lib/graph'

/* ============================================================
   МОСТ DESKTOP-ПРИЛОЖЕНИЯ (contract п.7 плана)
   window.workspacexDesktop появляется в Electron-обёртке: openPath —
   открыть файл программой по умолчанию, revealInExplorer — показать
   в проводнике. В браузере моста нет — действия выключены с подсказкой.
   ============================================================ */

export type WorkspaceXBridge = {
  openExternal?: (url: string) => void
  revealInExplorer?: (absPath: string) => void
  openPath?: (absPath: string) => void
}

export const BRIDGE_HINT = 'Доступно в приложении для Windows'

export function desktopBridge(): WorkspaceXBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { workspacexDesktop?: WorkspaceXBridge }).workspacexDesktop
}

/** absPath читается опционально: поле появится в метаданных у другого исполнителя. */
export function absPathOf(f: unknown): string | null {
  const p = (f as { absPath?: unknown } | null | undefined)?.absPath
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

/** Подпись, почему два объекта связаны: связь считает graph.ts, а не дизайн. */
export const REASON_LABEL: Record<EdgeReason, string> = {
  pin: 'стикер',
  tag: 'метка',
  cluster: 'кластер',
}
