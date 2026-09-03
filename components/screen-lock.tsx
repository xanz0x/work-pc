'use client'

/* ============================================================
   SCREEN-LOCK · полноэкранный замок сейфа
   Рендерится ПОВЕРХ app-shell при v.lock.status === 'locked'.
   PIN 4–8 цифр — ячейки с автопереходом фокуса; пароль — одно поле.
   Анти-брутфорс: busy (PBKDF2 идёт) + cooldownUntil (задержка).
   Вспышка danger при ошибке, вспышка акцента при успехе.
   Дисциплина «Графит»: тон + волосяные границы, без blur/теней.
   V3.5 «Хранилище»: retro-grid пол в перспективе снизу экрана,
   усиленные метеоры, 2-зонная карточка (кольцо-пульс / колодцы),
   гравировка над карточкой и статусная строка во всю нижнюю кромку.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LockMethod } from '@/lib/lock-store'
import { useLockStore } from '@/lib/vault-store'
import { adoptMasterSession } from '@/hooks/use-file-keys'
import { trackAction, trackDrop } from '@/lib/telemetry'
import { IconLockRound } from './icons'
import { LogoWord } from './screen-lock-logo'

const PIN_LEN = 6

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

function MeteorLayer() {
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
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okFlash, setOkFlash] = useState(false)
  const [tickNow, setTickNow] = useState(Date.now())
  const [activeCell, setActiveCell] = useState(0)
  const cellsRef = useRef<(HTMLInputElement | null)[]>([])

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
      className={`lock-screen${okFlash ? ' lock-ok' : ''}${error ? ' has-error' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Сейф заблокирован"
    >
      {/* Сцена «хранилище»: retro-grid пол снизу экрана + метеоры */}
      <div className="lock-floor" aria-hidden="true">
        <i />
      </div>

      <MeteorLayer />

      {/* Гравировка над карточкой */}
      <p className="lock-engrave num">SEIF 7F3A · РАСШИФРОВКА ТРЕБУЕТСЯ</p>

      <div className="lock-card">
        {/* Вспышка danger-кромки при ошибке (500ms), контент не трогает */}
        <i className="lock-edge" aria-hidden="true" />

        <div className="lock-head">
          <div className="lock-mark" aria-hidden="true">
            <IconLockRound />
            <i className="lock-pulse" />
            <i className="lock-pulse p2" />
          </div>

          <LogoWord className="lock-logo" />

          <p className="lock-tagline">local ai workspace · сейф заблокирован</p>
        </div>

        <div className="lock-well">
          {method === 'pin' ? (
            <>
              <div className={`lock-cells${error ? ' has-error' : ''}${disabled ? ' is-busy' : ''}`}>
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
                    data-testid={`lock-cell-${i}`}
                  />
                ))}
              </div>
              <p className="lock-hint num" role="status">
                {pinValue.length === 0
                  ? `Введите ${PIN_LEN} цифр пина`
                  : pinValue.length < PIN_LEN
                    ? `Осталось ${PIN_LEN - pinValue.length} — проверка запустится сама`
                    : '\u00A0'}
              </p>
            </>
          ) : (
            <form onSubmit={submitPassword}>
              <div className={`lock-pass${error ? ' has-error' : ''}${disabled ? ' is-busy' : ''}`}>
                <input
                  className="lock-input"
                  type={show ? 'text' : 'password'}
                  value={password}
                  disabled={disabled}
                  autoComplete="off"
                  placeholder="Мастер-пароль"
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  aria-label="Мастер-пароль"
                />
                <button type="button" className="icon-btn lock-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}>
                  {show ? 'скрыть' : 'показать'}
                </button>
              </div>
              <button className="lock-submit" type="submit" disabled={disabled || !password}>
                Разблокировать
              </button>
            </form>
          )}

          <p className={`lock-status num${error ? ' err' : ''}`} role="status">
            {lock.busy
              ? 'Проверяю ключ…'
              : cooling
                ? `Подождите ${fmtCooldown(lock.cooldownUntil - tickNow)} — попытка ${lock.failCount}`
                : error ?? '\u00A0'}
          </p>
        </div>
      </div>

      {/* Статусная строка во весь низ экрана — голос статус-бара приложения */}
      <footer className="lock-statusline num">
        <span>SESSION 7F3A</span>
        {/* ls-aux — сегменты, уходящие на узких экранах (RESPONSIVE v3.8):
            остаются SESSION и ПОПЫТКИ, между ними flex-разделитель */}
        <span className="sb-sep ls-aux">·</span>
        <span className="ls-aux">AES-256</span>
        <span className="sb-sep ls-aux">·</span>
        <span className="ls-aux">ЛОКАЛЬНЫЙ РЕЖИМ</span>
        <span className="ls-grow" />
        <span className="ls-aux">ЗАМОК С {lockedAtLabel || '—'}</span>
        <span className="sb-sep ls-aux">·</span>
        <span className="ls-attempts">ПОПЫТОК: {lock.failCount}</span>
        <span className="sb-sep ls-aux">·</span>
        <span className="ls-net ls-aux">
          <i className="net-dot" />ONLINE · 0 УТЕЧЕК
        </span>
      </footer>
    </div>
  )
}
