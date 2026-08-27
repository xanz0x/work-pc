'use client'

/* ============================================================
   SECURITY-SECTION · секция «Безопасность» экрана настроек
   Создание мастер-ключа (PIN/пароль), автоблокировка,
   смена ключа и выключение замка. Вся криптография — в
   lib/crypto-vault.ts; здесь только форма и состояния.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { IconKey, IconLockRound } from './icons'
import { useVault } from '@/lib/vault-store'
import type { LockMethod } from '@/lib/lock-store'

const AUTOLOCK_OPTIONS: { min: number; label: string }[] = [
  { min: 0, label: 'Никогда' },
  { min: 5, label: '5 мин' },
  { min: 10, label: '10 мин' },
  { min: 15, label: '15 мин' },
  { min: 30, label: '30 мин' },
]

export function SecuritySection() {
  const v = useVault()
  const lock = v.lock

  /* --- форма создания --- */
  const [creating, setCreating] = useState(false)
  const [method, setMethod] = useState<LockMethod>('pin')
  const [s1, setS1] = useState('')
  const [s2, setS2] = useState('')
  /* Живая проверка длины: PIN — ровно 6 цифр (как на экране блокировки),
     пароль — от 8 символов. */
  const s1LenOk = method === 'pin' ? /^\d{6}$/.test(s1) : s1.length >= 8
  const [err, setErr] = useState<string | null>(null)

  /* --- форма смены мастера --- */
  const [changing, setChanging] = useState(false)
  const [curSecret, setCurSecret] = useState('')
  const [next1, setNext1] = useState('')
  const [next2, setNext2] = useState('')

  /* --- выключение --- */
  const [disabling, setDisabling] = useState(false)
  const [disableSecret, setDisableSecret] = useState('')

  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (creating || changing || disabling) firstFieldRef.current?.focus()
  }, [creating, changing, disabling])

  function resetForms() {
    setCreating(false)
    setChanging(false)
    setDisabling(false)
    setS1('')
    setS2('')
    setCurSecret('')
    setNext1('')
    setNext2('')
    setDisableSecret('')
    setErr(null)
  }

  function strengthPw(pw: string): number {
    let n = 0
    if (pw.length >= 8) n++
    if (pw.length >= 12) n++
    if (/\d/.test(pw) && /[a-zA-Zа-яА-Я]/.test(pw)) n++
    if (/[^a-zA-Z0-9а-яА-Я]/.test(pw)) n++
    return Math.min(n, 4)
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!s1 || s1 !== s2) {
      setErr(s1 !== s2 ? 'Ключи не совпадают' : 'Введите ключ')
      return
    }
    if (method === 'pin' && !/^\d{4,8}$/.test(s1)) {
      setErr('Пин: от 4 до 8 цифр')
      return
    }
    if (method === 'password' && s1.length < 8) {
      setErr('Пароль: минимум 8 символов')
      return
    }
    const problem = await v.setupLock(s1, method)
    if (problem) {
      setErr(problem)
      return
    }
    v.flash(`Замок включён (${method === 'pin' ? 'пин' : 'пароль'})`)
    resetForms()
  }

  async function onChangeMaster(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!curSecret || next1.length < (lock.method === 'password' ? 8 : 6)) {
      setErr(lock.method === 'password' ? 'Новый пароль — минимум 8 символов' : 'Новый пин — ровно 6 цифр')
      return
    }
    if (lock.method === 'pin' && !/^\d{6}$/.test(next1)) {
      setErr('Новый пин — ровно 6 цифр')
      return
    }
    if (next1 !== next2) {
      setErr('Новые ключи не совпадают')
      return
    }
    const problem = await v.changeMaster(curSecret, next1)
    if (problem) {
      setErr(problem)
      return
    }
    v.flash('Мастер-ключ изменён')
    resetForms()
  }

  async function onDisable(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const problem = await v.disableLock(disableSecret)
    if (problem) {
      setErr(problem)
      return
    }
    v.flash('Замок выключен')
    resetForms()
  }

  function toggleChangeForm() {
    resetForms()
    setChanging(true)
  }

  /* ---------- Статус: замок не настроен ---------- */

  if (lock.status === 'off') {
    return (
      <section className="sec panel" id="set-security">
        <div className="sec-head">
          <span className="sec-icon">
            <IconLockRound />
          </span>
          <div className="sec-head-text">
            <div className="setting-title">Безопасность</div>
            <div className="setting-note">
              Мастер-ключ закрывает весь сейф. Ключи хранятся только на этом устройстве.
            </div>
          </div>
          <span className="sec-meta label-mono num">замок выключен</span>
        </div>

        {!creating ? (
          <button className="lock-setup-btn" onClick={() => setCreating(true)}>
            <IconLockRound width={13} height={13} aria-hidden="true" focusable="false" />
            Настроить мастер-ключ
          </button>
        ) : (
          <form className="lock-form lock-form-card" onSubmit={onCreate}>
            <div className="autolock-seg lf-method" role="radiogroup" aria-label="Тип ключа">
              <button
                type="button"
                role="radio"
                aria-checked={method === 'pin'}
                className={method === 'pin' ? 'active' : ''}
                onClick={() => {
                  setMethod('pin')
                  setS1('')
                  setS2('')
                  setErr(null)
                }}
              >
                PIN 6 цифр
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={method === 'password'}
                className={method === 'password' ? 'active' : ''}
                onClick={() => {
                  setMethod('password')
                  setS1('')
                  setS2('')
                  setErr(null)
                }}
              >
                Пароль
              </button>
            </div>

            {method === 'pin' ? (
              /* PIN: шесть ячеек как на экране блокировки — единый ментальный
                 образ «ввожу пин» в обоих местах, никаких текстовых полей. */
              <div className="lf-pin-duo">
                <div className="lf-field">
                  <label className="label-mono" htmlFor="sec-key-new">
                    Придумайте пин
                    <span className={`lf-count num${s1LenOk ? ' lf-count-ok' : s1 ? ' lf-count-bad' : ''}`}>
                      {s1.length}/6
                    </span>
                  </label>
                  <div className={`lock-cells lf-cells${s1 && !s1LenOk ? ' has-error' : ''}`}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <input
                        key={i}
                        id={i === 0 ? 'sec-key-new' : undefined}
                        ref={i === 0 ? firstFieldRef : undefined}
                        className={`lock-cell num${s1[i] ? ' filled' : ''}`}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={1}
                        value={s1[i] ?? ''}
                        onChange={(e) => {
                          const ch = e.target.value.replace(/\D/g, '').slice(-1)
                          const next = (s1.slice(0, i) + ch + s1.slice(i + 1)).slice(0, 6)
                          setS1(next)
                          setErr(null)
                          if (ch && i < 5) {
                            const el = e.currentTarget.parentElement?.children[i + 1] as HTMLInputElement | undefined
                            el?.focus()
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' && !s1[i] && i > 0) {
                            const el = e.currentTarget.parentElement?.children[i - 1] as HTMLInputElement | undefined
                            el?.focus()
                          }
                        }}
                        aria-label={`Цифра пина ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="lf-field">
                  <label className="label-mono" htmlFor="sec-key-rep">
                    Повторите пин
                    <span className={`lf-count num${s2 && s1 === s2 ? ' lf-count-ok' : ''}`}>
                      {s2 && s1 === s2 ? 'совпадает' : `${s2.length}/6`}
                    </span>
                  </label>
                  <div className={`lock-cells lf-cells${s2 && s1 !== s2 ? ' has-error' : ''}`}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <input
                        key={i}
                        id={i === 0 ? 'sec-key-rep' : undefined}
                        className={`lock-cell num${s2[i] ? ' filled' : ''}`}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={1}
                        value={s2[i] ?? ''}
                        onChange={(e) => {
                          const ch = e.target.value.replace(/\D/g, '').slice(-1)
                          const next = (s2.slice(0, i) + ch + s2.slice(i + 1)).slice(0, 6)
                          setS2(next)
                          setErr(null)
                          if (ch && i < 5) {
                            const el = e.currentTarget.parentElement?.children[i + 1] as HTMLInputElement | undefined
                            el?.focus()
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' && !s2[i] && i > 0) {
                            const el = e.currentTarget.parentElement?.children[i - 1] as HTMLInputElement | undefined
                            el?.focus()
                          }
                        }}
                        aria-label={`Повтор цифры пина ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="lf-field">
                  <label className="label-mono" htmlFor="sec-key-new">
                    Мастер-пароль
                    <span className={`lf-count num${s1LenOk ? ' lf-count-ok' : s1 ? ' lf-count-bad' : ''}`}>
                      {s1.length}/8+
                    </span>
                  </label>
                  <input
                    ref={firstFieldRef}
                    id="sec-key-new"
                    className={`lock-input num${s1 && !s1LenOk ? ' is-incomplete' : ''}`}
                    type="password"
                    autoComplete="new-password"
                    placeholder="от 8 символов"
                    value={s1}
                    onChange={(e) => {
                      setS1(e.target.value)
                      setErr(null)
                    }}
                  />
                  {s1.length > 0 && (
                    <div className={`lock-strength s${strengthPw(s1)}`} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                  )}
                </div>

                <div className="lf-field">
                  <label className="label-mono" htmlFor="sec-key-rep">
                    Подтверждение
                    <span className={`lf-count num${s2 && s1 === s2 ? ' lf-count-ok' : ''}`}>
                      {s2 && s1 === s2 ? 'совпадает' : `${s2.length}/${s1.length || '…'}`}
                    </span>
                  </label>
                  <input
                    id="sec-key-rep"
                    className={`lock-input num${s2 && s1 !== s2 ? ' is-incomplete' : ''}`}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Повторите"
                    value={s2}
                    onChange={(e) => {
                      setS2(e.target.value)
                      setErr(null)
                    }}
                  />
                </div>
              </>
            )}

            <p className="lock-warn">
              <IconKey width={12} height={12} aria-hidden="true" focusable="false" />
              <span title="Забытый мастер-ключ стирает доступ ко всем объектам под файловыми ключами. Это irreversible — запомните его.">
                Забытый мастер-ключ стирает файловые ключи
              </span>
            </p>
            {err && (
              <p className="lock-status err" role="alert">
                {err}
              </p>
            )}
            <div className="lock-actions lf-actions">
              <button className="lock-cancel" type="button" onClick={resetForms}>
                Отмена
              </button>
              <button className="lock-submit lf-submit" type="submit" disabled={!s1LenOk || !s2 || s1 !== s2}>
                {s1LenOk ? (s2 && s1 === s2 ? 'Включить замок' : method === 'pin' ? 'Повторите пин' : 'Повторите пароль') : method === 'pin' ? 'Введите 6 цифр' : 'Минимум 8 символов'}
              </button>
            </div>
          </form>
        )}
      </section>
    )
  }

  /* ---------- Замок активен ---------- */

  return (
    <section className="sec panel" id="set-security">
      <div className="sec-head">
        <span className="sec-icon active">
          <IconLockRound />
        </span>
        <div className="sec-head-text">
          <div className="setting-title">Безопасность</div>
          <div className="setting-note">Сейф защищён мастер-ключом</div>
        </div>
        <span className="sec-meta label-mono num ok-text">
          активен · {lock.method === 'pin' ? 'PIN' : 'пароль'}
        </span>
      </div>

      {/* Автоблокировка */}
      <div className="field-block">
        <div className="mask-head">
          <span className="label-mono">Автоблокировка простоя</span>
          <span className="mask-flag">{lock.autoLockMin === 0 ? 'выключена' : `${lock.autoLockMin} мин`}</span>
        </div>
        <div className="autolock-seg" role="radiogroup" aria-label="Автоблокировка простоя">
          {AUTOLOCK_OPTIONS.map((o) => (
            <button
              key={o.min}
              role="radio"
              aria-checked={lock.autoLockMin === o.min}
              className={lock.autoLockMin === o.min ? 'active' : ''}
              onClick={() => v.setAutoLock(o.min)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Управление ключом */}
      {!changing && !disabling ? (
        <div className="lock-actions row">
          <button className="lock-setup-btn inline" onClick={toggleChangeForm}>
            Изменить мастер-ключ
          </button>
          <button className="lock-cancel" onClick={() => setDisabling(true)}>
            Выключить замок
          </button>
          <button
            className="lock-setup-btn inline"
            title="Заблокировать сейф сейчас (Ctrl+Shift+L)"
            onClick={v.lockNow}
          >
            Заблокировать
          </button>
        </div>
      ) : null}

      {/* Смена мастера */}
      {changing && (
        <form className="lock-form lock-form-card" onSubmit={onChangeMaster}>
          <div className="lf-field">
            <label className="label-mono" htmlFor="sec-key-cur">
              Текущий ключ
            </label>
            <input
              ref={firstFieldRef}
              id="sec-key-cur"
              className="lock-input"
              type="password"
              autoComplete="current-password"
              value={curSecret}
              onChange={(e) => setCurSecret(e.target.value)}
            />
          </div>
          <div className="lf-field">
            <label className="label-mono" htmlFor="sec-key-next">
              Новый ключ
            </label>
            <input
              id="sec-key-next"
              className="lock-input num"
              type="password"
              autoComplete="new-password"
              value={next1}
              onChange={(e) => setNext1(e.target.value)}
            />
            {next1.length > 0 && (
              <div className={`lock-strength s${strengthPw(next1)}`} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="lf-field">
            <label className="label-mono" htmlFor="sec-key-rep2">
              Подтверждение
            </label>
            <input
              id="sec-key-rep2"
              className="lock-input"
              type="password"
              autoComplete="new-password"
              placeholder="Повторите новый"
              value={next2}
              onChange={(e) => setNext2(e.target.value)}
            />
          </div>
          <p className="lock-hint-inline">Файловые ключи продолжат работать — они переупакуются автоматически.</p>
          {err && (
            <p className="lock-status err" role="alert">
              {err}
            </p>
          )}
          <div className="lock-actions lf-actions">
            <button className="lock-cancel" type="button" onClick={resetForms}>
              Отмена
            </button>
            <button className="lock-submit lf-submit" type="submit" disabled={!curSecret || !next1}>
              Сменить ключ
            </button>
          </div>
        </form>
      )}

      {/* Выключение замка */}
      {disabling && (
        <form className="lock-form lock-form-card is-danger" onSubmit={onDisable}>
          <p className="lock-warn">
            <IconKey width={12} height={12} aria-hidden="true" focusable="false" />
            <span title="Вместе с замком будут стёрты все файловые ключи. Файлы останутся, но защита снимется.">
              С замком стираются файловые ключи
            </span>
          </p>
          <div className="lf-field">
            <label className="label-mono" htmlFor="sec-key-disable">
              Подтверждение
            </label>
            <input
              ref={firstFieldRef}
              id="sec-key-disable"
              className="lock-input"
              type="password"
              autoComplete="current-password"
              placeholder="Текущим мастер-ключом"
              value={disableSecret}
              onChange={(e) => setDisableSecret(e.target.value)}
            />
          </div>
          {err && (
            <p className="lock-status err" role="alert">
              {err}
            </p>
          )}
          <div className="lock-actions lf-actions">
            <button className="lock-cancel" type="button" onClick={resetForms}>
              Отмена
            </button>
            <button className="lock-danger-btn lf-danger" type="submit" disabled={!disableSecret}>
              Выключить замок
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
