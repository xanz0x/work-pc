'use client'

/* ============================================================
   ПОКАЗ СЕКРЕТА · маска по умолчанию, авто-скрытие, copy без показа
   Значение расшифровывается только на время показа и обнуляется:
   по таймеру, при уходе со страницы, при потере фокуса окна и по
   panic-lock (hideEpoch из secrets-store).
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy, IconEye, IconEyeOff } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import type { ClipTarget, SecretField } from '@/lib/secrets'

const MASK = '••••••••••••'

function targetOf(field: SecretField): ClipTarget {
  const n = field.name.toLowerCase()
  if (n.includes('cvv') || n.includes('cvc') || n.includes('pin')) return 'cvv'
  if (n.includes('логин') || n.includes('user') || n.includes('email')) return 'username'
  if (field.kind === 'password' || n.includes('пароль')) return 'password'
  return 'other'
}

export function SecretValue({
  entryId,
  field,
  compact = false,
}: {
  entryId: string
  field: SecretField
  compact?: boolean
}) {
  const s = useSecrets()
  const [shown, setShown] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setShown(null)
    setLeft(0)
  }, [])

  /* Panic-lock и любая блокировка гасят показ. */
  useEffect(hide, [s.hideEpoch, hide])

  /* Уход со страницы или потеря фокуса окна — тоже скрытие. */
  useEffect(() => {
    if (shown === null) return
    const off = () => hide()
    window.addEventListener('blur', off)
    document.addEventListener('visibilitychange', off)
    window.addEventListener('pagehide', off)
    return () => {
      window.removeEventListener('blur', off)
      document.removeEventListener('visibilitychange', off)
      window.removeEventListener('pagehide', off)
    }
  }, [shown, hide])

  /* Обратный отсчёт до авто-скрытия. */
  useEffect(() => {
    if (shown === null) return
    const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(id)
  }, [shown])

  async function reveal() {
    if (shown !== null) {
      hide()
      return
    }
    setBusy(true)
    const plain = await s.openValue(entryId, field.id)
    setBusy(false)
    if (plain === null) return
    /* Секунды показа защищены от кривого снимка настроек: минимум 1 с. */
    const secs = Math.max(1, Math.round(Number(s.settings.revealSeconds) || 8))
    setShown(plain)
    setLeft(secs)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(hide, secs * 1000)
  }

  async function copy() {
    setBusy(true)
    const plain = field.secret ? await s.openValue(entryId, field.id) : field.value
    setBusy(false)
    if (plain === null || plain === '') return
    await s.copySecret(plain, targetOf(field), field.name)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const empty = field.secret ? field.value === '' : !field.value

  return (
    <div className={`vt-val${compact ? ' compact' : ''}`}>
      <div className="vte-well vt-val-well">
        <span
          className={`vt-val-text mono${shown === null ? ' masked' : ''}${field.kind === 'multiline' ? ' multi' : ''}`}
          data-testid={`secret-value-${field.id}`}
        >
          {empty ? '—' : shown === null ? (field.secret ? MASK : field.value) : shown}
        </span>
        {shown !== null && left > 0 && <span className="vt-val-left num" data-testid={`secret-reveal-countdown-${field.id}`}>{left}с</span>}
        {field.secret && !empty && (
          <button
            className="vte-btn"
            onClick={reveal}
            disabled={busy}
            title={shown === null ? `Показать на ${s.settings.revealSeconds} с` : 'Скрыть'}
            aria-label={shown === null ? 'Показать значение' : 'Скрыть значение'}
            data-testid={`reveal-${field.id}`}
          >
            {shown === null ? <IconEye /> : <IconEyeOff />}
          </button>
        )}
        {!empty && (
          <button
            className={`vte-btn${copied ? ' is-ok' : ''}`}
            onClick={copy}
            disabled={busy}
            title="Скопировать без показа"
            aria-label="Скопировать значение"
            data-testid={`copy-${field.id}`}
          >
            {copied ? <IconCheck /> : <IconCopy />}
          </button>
        )}
      </div>
    </div>
  )
}
