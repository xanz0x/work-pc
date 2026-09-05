'use client'

/* Полноэкранная разблокировка: 6 цифр PIN или мастер-пароль.
   Общий стиль access.css; проверка, cooldown и ключи — в существующем store.
   MeteorLayer сохранён для других потребителей, но на формах доступа не используется. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LockMethod } from '@/lib/lock-store'
import { useLockStore } from '@/lib/vault-store'
import { adoptMasterSession } from '@/hooks/use-file-keys'
import { trackAction, trackDrop } from '@/lib/telemetry'
import { IconLockRound } from './icons'
import { LogoWord } from './screen-lock-logo'
import { PasswordInput } from './password-input'
import { ResetLockDialog } from './reset-lock-dialog'
import { useDialog } from '@/hooks/use-dialog'
import { PIN_LENGTH } from './mk-fields'

const PIN_LEN = PIN_LENGTH

/* ============================================================
   METEORS · порт Magic UI «meteors» (https://magicui.design/r/meteors.json)
   на CSS-анимацию без зависимостей. Голова — точка тоном
   --border-3, хвост — волосная линия с градиентным раствором,
   полёт по диагонали rotate(--angle) + translateX. Стили метеоров
   назначаются в useEffect (как в оригинале) → нет расхождения
   гидратации; reduced-motion глушится глобальным правилом CSS.
   v3.7: 5 метеоров с фиксированным раскладом (без Math.random на
   каждый рендер) — позиции подобраны вручную, покрывают ширину,
   детерминированы между SSR и клиентом. Каждый метеор — свой
   композитный слой (will-change в CSS), CPU не участвует.
   ============================================================ */

type MeteorStyle = { left: string; delay: string; dur: string }

/* Фиксированный расклад: детерминированный, покрывает ширину равномерно,
   фазы разнесены — сцена живая, но без перегенерации стилей. */
const METEOR_LAYOUT: MeteorStyle[] = [
  { left: '4%', delay: '0.0s', dur: '7.2s' },
  { left: '21%', delay: '2.4s', dur: '6.1s' },
  { left: '38%', delay: '4.8s', dur: '7.8s' },
  { left: '55%', delay: '1.2s', dur: '6.6s' },
  { left: '72%', delay: '3.6s', dur: '7.4s' },
  { left: '88%', delay: '5.9s', dur: '6.3s' },
]

export function MeteorLayer() {
  return (
    <div className="lock-meteors" aria-hidden="true">
      {METEOR_LAYOUT.map((m, i) => (
        <i
          key={i}
          className="meteor"
          style={{ left: m.left, animationDelay: m.delay, animationDuration: m.dur }}
        />
      ))}
    </div>
  )
}

function fmtCooldown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return `${s} с`
}

export function ScreenLock() {
  /* Узкая подписка: экран замка знает только домен замка, поэтому тик часов,
     новые уведомления и правка настроек его больше не перерисовывают. */
  const v = useLockStore()
  const lock = v.lock
  const method: LockMethod = lock.method ?? 'pin'

  const [pin, setPin] = useState<string[]>(Array(PIN_LEN).fill(''))
  const [password, setPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okFlash, setOkFlash] = useState(false)
  const [tickNow, setTickNow] = useState(Date.now())
  const [activeCell, setActiveCell] = useState(0)
  const cellsRef = useRef<(HTMLInputElement | null)[]>([])
  const { dialogProps } = useDialog<HTMLDivElement>({ onClose: () => {}, label: 'Сейф заблокирован' })

  /* Тик для обратного отсчёта cooldown. */
  useEffect(() => {
    const id = window.setInterval(() => setTickNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [])

  const cooling = lock.cooldownUntil > tickNow

  useEffect(() => {
    /* Фокус в первое поле на каждом появлении экрана. */
    cellsRef.current[0]?.focus()
  }, [])

  const lockedAtLabel = useMemo(() => {
    if (!lock.lockedAt) return ''
    return new Date(lock.lockedAt).toLocaleTimeString('ru-RU', { hour12: false })
  }, [lock.lockedAt])

  function fail(msg: string) {
    setError(msg)
    setPin(Array(PIN_LEN).fill(''))
    setPassword('')
    requestAnimationFrame(() => cellsRef.current[0]?.focus())
  }

  async function attempt(secret: string) {
    if (lock.busy || cooling) return
    setError(null)
    const ok = await v.unlock(secret)
    if (ok) {
      /* Этап 5: мастер принимается в память сессии для wrapped-ключей,
         пока статус ещё 'locked' — до завершающего completeUnlock(). */
      try {
        await adoptMasterSession(secret)
      } catch {
        /* без сессии мастера файловые ключи просто недоступны до следующего unlock */
      }
      trackAction('lock.unlock')
      setOkFlash(true)
      window.setTimeout(() => v.completeUnlock(), 450)
    } else {
      trackDrop('lock.unlock.failed')
      fail('Ключ не подходит')
    }
  }

  /* ---------- PIN ---------- */

  function setCell(i: number, ch: string) {
    if (!/\d/.test(ch)) return
    const next = [...pin]
    next[i] = ch
    setPin(next)
    setError(null)
    const filled = next.every(Boolean)
    if (filled && !lock.busy) void attempt(next.join(''))
    else cellsRef.current[Math.min(i + 1, PIN_LEN - 1)]?.focus()
  }

  function onCellKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const next = [...pin]
      if (next[i]) {
        next[i] = ''
        setPin(next)
      } else if (i > 0) {
        next[i - 1] = ''
        setPin(next)
        cellsRef.current[i - 1]?.focus()
      }
      return
    }
    if (e.key === 'ArrowLeft' && i > 0) cellsRef.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < PIN_LEN - 1) cellsRef.current[i + 1]?.focus()
  }

  function onCellPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '')
    if (!digits) return
    e.preventDefault()
    const next = Array(PIN_LEN).fill('') as string[]
    for (let i = 0; i < Math.min(PIN_LEN, digits.length); i++) next[i] = digits[i]
    setPin(next)
    if (next.every(Boolean) && !lock.busy) void attempt(next.join(''))
  }

  const pinValue = pin.join('')

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    await attempt(password)
  }

  const disabled = lock.busy || cooling

  return (
    <div
      className="lock-screen access-scene"
      {...dialogProps}
      data-testid="lock-screen"
    >
      <div className="access-stack" inert={resetting}>
      <div className="access-brand" data-testid="lock-brand"><LogoWord /></div>
      <div className="access-card">
        <header className="access-heading">
          <span className="access-mark" aria-hidden="true"><IconLockRound /></span>
          <h1 data-testid="lock-title">Сейф заблокирован</h1>
          <p data-testid="lock-description">{method === 'pin' ? 'Введите PIN из 6 цифр.' : 'Введите мастер-пароль для продолжения.'}</p>
        </header>
        <div className="access-body">
          {method === 'pin' ? (
            <>
              <div className={`access-pin-cells${error ? ' has-error' : ''}`}>
                {pin.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      cellsRef.current[i] = el
                    }}
                    className={`lock-cell num${d ? ' filled' : ''}${!disabled && i === activeCell ? ' cursor' : ''}`}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={1}
                    value={d}
                    disabled={disabled}
                    onChange={(e) => setCell(i, e.target.value.slice(-1))}
                    onKeyDown={(e) => onCellKey(i, e)}
                    onPaste={onCellPaste}
                    onFocus={() => setActiveCell(i)}
                    aria-label={`Цифра пин-кода ${i + 1}`}
                    aria-invalid={!!error}
                    data-testid={`lock-cell-${i}`}
                  />
                ))}
              </div>
              <p className="access-hint" role="status" data-testid="lock-pin-hint">
                {pinValue.length === 0
                  ? 'Проверка начнётся после последней цифры.'
                  : pinValue.length < PIN_LEN
                    ? `Введено ${pinValue.length} из ${PIN_LEN} цифр`
                    : 'PIN введён'}
              </p>
            </>
          ) : (
            <form onSubmit={submitPassword} className="access-field">
              <label htmlFor="unlock-password" data-testid="lock-password-label">Мастер-пароль</label>
                <PasswordInput
                  id="unlock-password"
                  testId="lock-password"
                  value={password}
                  disabled={disabled}
                  autoComplete="off"
                  placeholder="Мастер-пароль"
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  aria-label="Мастер-пароль"
                  aria-invalid={!!error}
                />
              <button className="access-primary" type="submit" disabled={disabled || !password} data-testid="lock-password-submit">
                {lock.busy ? 'Проверяем…' : 'Разблокировать'}
              </button>
            </form>
          )}

          <p className={error && !cooling ? 'access-alert' : 'access-unlock-status'} role={error && !cooling ? 'alert' : 'status'} data-testid="lock-status">
            {lock.busy
              ? 'Проверяем ключ…'
              : okFlash
                ? 'Сейф разблокирован'
              : cooling
                ? `Следующая попытка через ${fmtCooldown(lock.cooldownUntil - tickNow)}`
                : error ?? ''}
          </p>
          <button className="access-link" type="button" disabled={lock.busy || okFlash} onClick={() => setResetting(true)} data-testid="lock-forgot-key">Не помню мастер-ключ</button>
        </div>
      </div>

      <footer className="access-meta">
        <span data-testid="lock-locked-at">Блокировка: {lockedAtLabel || '—'}</span>
        <span data-testid="lock-failed-attempts">Неудачных попыток: {lock.failCount}</span>
      </footer>
      </div>
      {resetting && <ResetLockDialog onClose={() => setResetting(false)} onReset={v.resetLock} />}
    </div>
  )
}
