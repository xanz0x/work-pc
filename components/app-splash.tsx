'use client'

/* Сплэш холодного старта: знак собирается из линий, слово проявляется,
   полоса показывает, что сейф читается с устройства. Уходит, как только
   каркас ожил, и больше в этой сессии не возвращается. */

import { useEffect, useState } from 'react'
import { IconLogoMark } from './icons'
import { LogoWord } from './screen-lock-logo'

/** Один раз за загрузку страницы: повторный монтаж каркаса сплэш не воскрешает. */
let dismissed = false

export function AppSplash({ done }: { done: boolean }) {
  const [gone, setGone] = useState(dismissed)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (dismissed) return
    /* Страховка: даже если сейф не отчитался о гидратации, сплэш уходит
       через 2.5 секунды и не запирает интерфейс. */
    const cap = window.setTimeout(() => setFading(true), 2500)
    return () => window.clearTimeout(cap)
  }, [])

  useEffect(() => {
    if (done) setFading(true)
  }, [done])

  useEffect(() => {
    if (!fading) return
    const t = window.setTimeout(() => {
      dismissed = true
      setGone(true)
    }, 420)
    return () => window.clearTimeout(t)
  }, [fading])

  if (gone) return null

  return (
    <div
      className={`splash${fading ? ' is-done' : ''}`}
      data-testid="app-splash"
      role="status"
      aria-live="polite"
      aria-label="Загрузка сейфа"
    >
      <div className="splash-inner">
        <span className="splash-mark" aria-hidden="true">
          <IconLogoMark />
        </span>
        <LogoWord className="splash-word" />
        <span className="splash-sub label-mono">local ai workspace</span>
        <span className="splash-bar" aria-hidden="true">
          <i />
        </span>
      </div>
    </div>
  )
}
