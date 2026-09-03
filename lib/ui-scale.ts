/* ============================================================
   МАСШТАБ ИНТЕРФЕЙСА
   Один множитель на весь каркас: пишется в `--ui-zoom` на <html>,
   применяется CSS-свойством `zoom` к <body>. Значение живёт в
   localStorage и поднимается bootstrap-скриптом в app/layout.tsx до
   первого кадра — интерфейс не «прыгает» после гидратации.
   ============================================================ */

export const SCALE_KEY = 'wf.ui.scale'
export const SCALE_MIN = 80
export const SCALE_MAX = 150
export const SCALE_STEP = 5
export const SCALE_DEFAULT = 100

const listeners = new Set<() => void>()
let current = SCALE_DEFAULT

export function clampScale(v: number): number {
  const stepped = Math.round(v / SCALE_STEP) * SCALE_STEP
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, stepped))
}

function apply(v: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--ui-zoom', String(v / 100))
  document.documentElement.dataset.uiScale = String(v)
}

/** Прочитать сохранённый масштаб и применить его. Зовётся один раз при старте. */
export function initScale(): number {
  if (typeof window === 'undefined') return SCALE_DEFAULT
  const raw = Number(localStorage.getItem(SCALE_KEY))
  current = Number.isFinite(raw) && raw > 0 ? clampScale(raw) : SCALE_DEFAULT
  apply(current)
  return current
}

export function getScale(): number {
  return current
}

export function setScale(v: number): void {
  const next = clampScale(v)
  if (next === current) return
  current = next
  apply(next)
  try {
    localStorage.setItem(SCALE_KEY, String(next))
  } catch {
    /* приватный режим — масштаб живёт до перезагрузки */
  }
  listeners.forEach((fn) => fn())
}

export function stepScale(dir: 1 | -1): void {
  setScale(current + dir * SCALE_STEP)
}

export function resetScale(): void {
  setScale(SCALE_DEFAULT)
}

export function subscribeScale(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
