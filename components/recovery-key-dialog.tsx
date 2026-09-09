'use client'

/* ============================================================
   RECOVERY-KEY DIALOG · ключ восстановления замка (схема BitLocker)
   Два пути с экрана «Не помню мастер-ключ»:
     1. «Есть код восстановления» — код WSXR-… расшифровывает старый
        мастер-секрет, магазин выполняет ту же цепочку, что смена
        мастера (rewrapAll) → защищённые данные остаются целыми.
        Анти-брутфорс: пять неверных кодов без кулдауна, дальше —
        failDelayMs как у мастера; failCount мастера не растёт.
     2. «Кода нет» — прежний деструктивный путь: предупреждение и
        ResetLockDialog как шаг подтверждения (ввод СБРОСИТЬ).

   Здесь же RecoveryCodeCard — одноразовая выдача кода после
   setupLock/changeMaster (настройки, онбординг): «Скопировать» и
   предупреждение «показывается один раз».
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import type { LockMethod } from '@/lib/lock-store'
import { validateSecret } from '@/lib/lock-store'
import { hasRecoveryCode } from '@/lib/lock-store'
import { useLockStore } from '@/lib/vault-store'
import { trackAction, trackDrop } from '@/lib/telemetry'
import { IconAlertTri, IconCheck, IconClose, IconKey } from './icons'
import { MkPassField, MkPinRow, strengthPw } from './mk-fields'
import { ResetLockDialog } from './reset-lock-dialog'
import { useDialog } from '@/hooks/use-dialog'

function fmtCooldown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return `${s} с`
}

/* ============================================================
   RECOVERY CODE CARD · выдача кода ровно один раз
   Тело диалога: показ кода, «Скопировать» и предупреждение.
   Кнопку «Я записал код» даёт хост (футер своего диалога).
   ============================================================ */

export function RecoveryCodeCard({ code, testId = 'recovery-code' }: { code: string; testId?: string }) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => window.clearTimeout(copiedTimerRef.current)
  }, [])

  function flashCopied() {
    setCopied(true)
    window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2500)
  }

  function copy() {
    /* Кладём в буфер; если clipboard запрещён — выделяем для ручного копирования. */
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code).then(flashCopied, () => inputRef.current?.select())
    } else {
      inputRef.current?.select()
    }
  }

  return (
    <>
      <div className="mk-field">
        <label className="label-mono mk-label" htmlFor={`${testId}-value`}>
          <span>Ключ восстановления</span>
          <span className="mk-hint num">{code.length} симв.</span>
        </label>
        <input
          ref={inputRef}
          id={`${testId}-value`}
          readOnly
          value={code}
          onFocus={(e) => e.currentTarget.select()}
          className="lock-input mk-input num"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${testId}-warning`}
          data-testid={`${testId}-value`}
        />
        <button type="button" className="mk-cancel" onClick={copy} data-testid={`${testId}-copy`}>
          {copied ? (
            <>
              <IconCheck width={13} height={13} aria-hidden="true" focusable="false" /> Скопировано
            </>
          ) : (
            'Скопировать'
          )}
        </button>
      </div>
      <p className="mk-warn is-danger" data-testid={`${testId}-warning`}>
        <IconAlertTri width={14} height={14} aria-hidden="true" focusable="false" />
        <span>Запиши код — он показывается один раз; без него при утере мастер-ключа данные будут потеряны.</span>
      </p>
      <p className="mk-note" data-testid={`${testId}-note`}>
        Код разблокирует сейф, если мастер-ключ забыт, и хранится только на этом устройстве.
        Новый код выдаётся при смене мастер-ключа.
      </p>
    </>
  )
}

/* ============================================================
   RECOVERY DIALOG · экран блокировки, кнопка «Не помню мастер-ключ»
   ============================================================ */

export function RecoveryDialog({ onClose }: { onClose: () => void }) {
  const v = useLockStore()
  const lock = v.lock
  const method0: LockMethod = lock.method ?? 'pin'

  /* Запись recovery есть только у замков, созданных после появления кодов. */
  const [codeAvailable] = useState(() => hasRecoveryCode())
  const [tab, setTab] = useState<'code' | 'reset'>(() => (hasRecoveryCode() ? 'code' : 'reset'))
  const [confirmingReset, setConfirmingReset] = useState(false)

  const [method, setMethod] = useState<LockMethod>(method0)
  const [code, setCode] = useState('')
  const [s1, setS1] = useState('')
  const [s2, setS2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const { dialogProps } = useDialog<HTMLFormElement>({
    onClose: confirmingReset ? () => setConfirmingReset(false) : onClose,
    label: 'Не помню мастер-ключ',
  })

  /* Тик для обратного отсчёта кулдауна восстановления. */
  const [tickNow, setTickNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setTickNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [])

  const cooling = v.recoveryCooldownUntil > tickNow
  const codeOk = /^WSXR-[A-Za-z0-9_-]{43}$/.test(code.trim())
  const s1Ok = !validateSecret(s1, method)
  const canRecover = codeOk && s1Ok && s1 === s2 && !lock.busy && !cooling

  async function onRecover(e: React.FormEvent) {
    e.preventDefault()
    if (!canRecover) return
    setErr(null)
    const problem = await v.recoverWithKey(code.trim(), s1, method)
    if (problem !== null) {
      trackDrop('lock.recovery.failed')
      setErr(problem)
      return
    }
    /* Статус уже 'unlocked' — экран блокировки закрывается сам. */
    trackAction('lock.recovery')
    onClose()
  }

  return (
    <div className="access-modal-back" onPointerDown={onClose} data-testid="recovery-backdrop">
      {confirmingReset ? (
        /* Шаг подтверждения деструктивного пути — прежний диалог целиком. */
        <ResetLockDialog
          onClose={() => setConfirmingReset(false)}
          onReset={() => {
            v.resetLock()
            onClose()
          }}
        />
      ) : (
        <form
          className={`mk-card${tab === 'reset' ? ' is-danger' : ''}`}
          {...dialogProps}
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={onRecover}
          data-testid="recovery-modal"
        >
          <header className="mk-head">
            <span className="mk-head-ico" aria-hidden="true"><IconKey /></span>
            <div className="mk-head-text">
              <h2 className="mk-title" data-testid="recovery-title">Не помню мастер-ключ</h2>
              <p className="mk-sub" data-testid="recovery-description">
                {codeAvailable ? 'Код восстановления или полный сброс' : 'Код восстановления не найден'}
              </p>
            </div>
            <button className="mk-x" type="button" onClick={onClose} aria-label="Закрыть" data-testid="recovery-close">
              <IconClose />
            </button>
          </header>

          <div className="mk-body">
            {codeAvailable && (
              <div className="mk-tabs" role="radiogroup" aria-label="Путь без мастер-ключа">
                <button
                  type="button"
                  role="radio"
                  aria-checked={tab === 'code'}
                  className={`mk-tab${tab === 'code' ? ' active' : ''}`}
                  onClick={() => {
                    setTab('code')
                    setErr(null)
                  }}
                  data-testid="recovery-tab-code"
                >
                  Есть код восстановления
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={tab === 'reset'}
                  className={`mk-tab${tab === 'reset' ? ' active' : ''}`}
                  onClick={() => {
                    setTab('reset')
                    setErr(null)
                  }}
                  data-testid="recovery-tab-reset"
                >
                  Кода нет
                </button>
              </div>
            )}

            {tab === 'code' && codeAvailable ? (
              <>
                <div className="mk-field">
                  <label className="label-mono mk-label" htmlFor="recovery-code-input">
                    <span>Код восстановления</span>
                    <span className="mk-hint num">{code.trim().length > 0 ? `${code.trim().length}/48` : 'WSXR-…'}</span>
                  </label>
                  <input
                    id="recovery-code-input"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value)
                      setErr(null)
                    }}
                    placeholder="WSXR-…"
                    className="lock-input mk-input num"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={lock.busy || cooling}
                    aria-invalid={Boolean(err) || undefined}
                    data-testid="recovery-code-input"
                  />
                </div>

                <div className="mk-tabs" role="radiogroup" aria-label="Новый тип ключа">
                  {(['pin', 'password'] as LockMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={method === m}
                      className={`mk-tab${method === m ? ' active' : ''}`}
                      onClick={() => {
                        setMethod(m)
                        setS1('')
                        setS2('')
                        setErr(null)
                      }}
                      data-testid={`recovery-method-${m}`}
                    >
                      {m === 'pin' ? 'Новый PIN · 6 цифр' : 'Новый пароль'}
                    </button>
                  ))}
                </div>

                {method === 'pin' ? (
                  <>
                    <MkPinRow
                      idBase="recovery-new"
                      label="Новый PIN"
                      hint={`${s1.length}/6`}
                      hintTone={s1Ok ? 'ok' : s1 ? 'bad' : undefined}
                      value={s1}
                      onChange={(next) => {
                        setS1(next)
                        setErr(null)
                      }}
                      hasError={Boolean(s1) && !s1Ok}
                      testId="recovery-new"
                    />
                    <MkPinRow
                      idBase="recovery-rep"
                      label="Повторите PIN"
                      hint={s2 && s1 === s2 ? 'совпадает' : `${s2.length}/6`}
                      hintTone={s2 && s1 === s2 ? 'ok' : undefined}
                      value={s2}
                      onChange={(next) => {
                        setS2(next)
                        setErr(null)
                      }}
                      hasError={Boolean(s2) && s1 !== s2}
                      testId="recovery-repeat"
                    />
                  </>
                ) : (
                  <>
                    <MkPassField
                      id="recovery-new"
                      label="Новый мастер-пароль"
                      hint={s1 ? `${s1.length} символов` : 'От 8 символов'}
                      hintTone={s1Ok ? 'ok' : s1 ? 'bad' : undefined}
                      value={s1}
                      onChange={(next) => {
                        setS1(next)
                        setErr(null)
                      }}
                      placeholder="от 8 символов"
                      autoComplete="new-password"
                      incomplete={Boolean(s1) && !s1Ok}
                      testId="recovery-new"
                    >
                      {s1.length > 0 && (
                        <div className={`lock-strength s${strengthPw(s1)}`} aria-hidden="true">
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                      )}
                    </MkPassField>
                    <MkPassField
                      id="recovery-repeat"
                      label="Подтверждение"
                      hint={s2 && s1 === s2 ? 'совпадает' : undefined}
                      hintTone={s2 && s1 === s2 ? 'ok' : undefined}
                      value={s2}
                      onChange={(next) => {
                        setS2(next)
                        setErr(null)
                      }}
                      placeholder="Повторите"
                      autoComplete="new-password"
                      incomplete={Boolean(s2) && s1 !== s2}
                      testId="recovery-repeat"
                    />
                  </>
                )}

                {err && (
                  <p className="mk-err" role="alert" data-testid="recovery-error">
                    {err}
                  </p>
                )}
                <p className="mk-note" data-testid="recovery-note">
                  Защищённые файлы и секретные записки останутся целыми — доступ откроется новым мастер-ключом.
                  После входа новый код восстановления выдаётся в «Безопасность → Изменить мастер-ключ».
                </p>
              </>
            ) : (
              <>
                <p className="mk-warn is-danger" data-testid="recovery-reset-warning">
                  <IconAlertTri width={14} height={14} aria-hidden="true" focusable="false" />
                  <span>
                    {codeAvailable
                      ? 'Код восстановления не сохранился. Без него восстановить доступ нельзя: сброс удалит мастер-ключ и сохранённые файловые ключи. Файлы останутся, но доступ к зашифрованным секретам и защищённому содержимому без прежних ключей будет потерян.'
                      : 'У этого замка нет ключа восстановления: он создан до появления кодов. Единственный путь — полный сброс: мастер-ключ и сохранённые файловые ключи будут удалены. Файлы останутся, но доступ к зашифрованным секретам и защищённому содержимому без прежних ключей будет потерян.'}
                  </span>
                </p>
                <p className="mk-note" data-testid="recovery-reset-note">
                  Дальше откроется подтверждение сброса — оттуда назад пути нет.
                </p>
              </>
            )}
          </div>

          <footer className="mk-foot">
            {tab === 'code' && codeAvailable ? (
              <>
                <button className="mk-cancel" type="button" onClick={onClose} data-testid="recovery-cancel">
                  Отмена
                </button>
                <button className="mk-submit" type="submit" disabled={!canRecover} data-testid="recovery-submit">
                  {lock.busy ? 'Проверяем…' : 'Восстановить доступ'}
                </button>
              </>
            ) : (
              <>
                <button
                  className="mk-cancel"
                  type="button"
                  onClick={onClose}
                  disabled={lock.busy}
                  data-testid="recovery-cancel"
                >
                  Отмена
                </button>
                <button
                  className="mk-submit is-danger"
                  type="button"
                  disabled={lock.busy || confirmingReset}
                  onClick={() => setConfirmingReset(true)}
                  data-testid="recovery-reset-open"
                >
                  <IconAlertTri width={13} height={13} aria-hidden="true" focusable="false" />
                  Сбросить замок без кода
                </button>
              </>
            )}
          </footer>
        </form>
      )}
    </div>
  )
}