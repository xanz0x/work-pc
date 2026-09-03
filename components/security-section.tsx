'use client'

/* ============================================================
   SECURITY-SECTION · секция «Безопасность» экрана настроек
   Создание мастер-ключа (PIN/пароль), автоблокировка,
   смена ключа и выключение замка. Вся криптография — в
   lib/crypto-vault.ts; здесь только форма и состояния.

   v4 · перенос макета: формы ключа живут в модальном окне
   «Безопасность · МАСТЕР-КЛЮЧ» — шапка с иконкой и статусной
   точкой, сегмент PIN/пароль, поля с подсказкой справа и глазом,
   баннер-предупреждение с кромкой, футер с действиями.
   Палитра и радиусы — наши, «Графит».
   ============================================================ */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconAlertTri, IconClose, IconKey, IconLockRound } from './icons'
import { MkPassField, MkPinRow, strengthPw } from './mk-fields'
import { useVault } from '@/lib/vault-store'
import type { LockMethod } from '@/lib/lock-store'

const AUTOLOCK_OPTIONS: { min: number; label: string }[] = [
  { min: 0, label: 'Никогда' },
  { min: 5, label: '5 мин' },
  { min: 10, label: '10 мин' },
  { min: 15, label: '15 мин' },
  { min: 30, label: '30 мин' },
]

/** Окно ключа: шапка, тело формы и футер действий — один каркас на три формы. */
function MkModal({
  title,
  sub,
  danger,
  onClose,
  onSubmit,
  children,
  footer,
  testId,
}: {
  title: string
  sub: string
  danger?: boolean
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  children: ReactNode
  footer: ReactNode
  testId: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="mk-back" role="presentation" onPointerDown={onClose}>
      <form
        className={`mk-card panel${danger ? ' is-danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        data-testid={testId}
      >
        <header className="mk-head">
          <span className="mk-head-ico" aria-hidden="true">
            <IconLockRound />
          </span>
          <div className="mk-head-text">
            <h2 className="mk-title">{title}</h2>
            <span className="mk-sub label-mono">
              <i className="mk-dot" aria-hidden="true" />
              {sub}
            </span>
          </div>
          <button
            className="mk-x"
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            data-testid="mk-close"
          >
            <IconClose />
          </button>
        </header>
        <div className="mk-body">{children}</div>
        <footer className="mk-foot">{footer}</footer>
      </form>
    </div>
  )
}

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
  }, [creating, changing, disabling, method])

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

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!s1 || s1 !== s2) {
      setErr(s1 !== s2 ? 'Ключи не совпадают' : 'Введите ключ')
      return
    }
    if (method === 'pin' && !/^\d{6}$/.test(s1)) {
      setErr('Пин: ровно 6 цифр')
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
      setErr(
        lock.method === 'password' ? 'Новый пароль — минимум 8 символов' : 'Новый пин — ровно 6 цифр',
      )
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

  const warnBanner = (
    <p className="mk-warn" data-testid="mk-warn">
      <IconAlertTri width={14} height={14} aria-hidden="true" focusable="false" />
      <span>Забытый мастер-ключ стирает файловые ключи</span>
    </p>
  )

  const errLine = err ? (
    <p className="mk-err" role="alert" data-testid="mk-error">
      {err}
    </p>
  ) : null

  /* ---------- Форма создания ключа (модальное окно макета) ---------- */

  const createModal = creating ? (
    <MkModal
      title="Безопасность"
      sub="МАСТЕР-КЛЮЧ"
      onClose={resetForms}
      onSubmit={onCreate}
      testId="mk-modal"
      footer={
        <>
          <button className="mk-cancel" type="button" onClick={resetForms} data-testid="mk-cancel">
            Отмена
          </button>
          <button
            className="mk-submit"
            type="submit"
            disabled={!s1LenOk || !s2 || s1 !== s2}
            data-testid="mk-submit"
          >
            <IconKey width={13} height={13} aria-hidden="true" focusable="false" />
            {s1LenOk
              ? s2 && s1 === s2
                ? 'Включить замок'
                : method === 'pin'
                  ? 'Повторите пин'
                  : 'Повторите пароль'
              : method === 'pin'
                ? 'Введите 6 цифр'
                : 'Минимум 8 символов'}
          </button>
        </>
      }
    >
      <div className="mk-tabs" role="radiogroup" aria-label="Тип ключа">
        <button
          type="button"
          role="radio"
          aria-checked={method === 'pin'}
          className={`mk-tab${method === 'pin' ? ' active' : ''}`}
          onClick={() => {
            setMethod('pin')
            setS1('')
            setS2('')
            setErr(null)
          }}
          data-testid="mk-tab-pin"
        >
          PIN 6 цифр
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={method === 'password'}
          className={`mk-tab${method === 'password' ? ' active' : ''}`}
          onClick={() => {
            setMethod('password')
            setS1('')
            setS2('')
            setErr(null)
          }}
          data-testid="mk-tab-password"
        >
          Пароль
        </button>
      </div>

      {method === 'pin' ? (
        <>
          <MkPinRow
            idBase="sec-key-new"
            label="Придумайте пин"
            hint={`${s1.length}/6`}
            hintTone={s1LenOk ? 'ok' : s1 ? 'bad' : undefined}
            value={s1}
            onChange={(next) => {
              setS1(next)
              setErr(null)
            }}
            hasError={Boolean(s1) && !s1LenOk}
            firstRef={firstFieldRef}
            testId="mk-pin1"
          />
          <MkPinRow
            idBase="sec-key-rep"
            label="Повторите пин"
            hint={s2 && s1 === s2 ? 'совпадает' : `${s2.length}/6`}
            hintTone={s2 && s1 === s2 ? 'ok' : undefined}
            value={s2}
            onChange={(next) => {
              setS2(next)
              setErr(null)
            }}
            hasError={Boolean(s2) && s1 !== s2}
            testId="mk-pin2"
          />
        </>
      ) : (
        <>
          <MkPassField
            id="sec-key-new"
            label="Мастер-пароль"
            hint={s1 ? `${s1.length}/8+` : 'min 8 chars'}
            hintTone={s1LenOk ? 'ok' : s1 ? 'bad' : undefined}
            value={s1}
            onChange={(next) => {
              setS1(next)
              setErr(null)
            }}
            placeholder="от 8 символов"
            autoComplete="new-password"
            inputRef={firstFieldRef}
            incomplete={Boolean(s1) && !s1LenOk}
            testId="mk-pass1"
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
            id="sec-key-rep"
            label="Подтверждение"
            hint={s2 && s1 === s2 ? 'совпадает' : s2 ? `${s2.length}/${s1.length || '…'}` : undefined}
            hintTone={s2 && s1 === s2 ? 'ok' : undefined}
            value={s2}
            onChange={(next) => {
              setS2(next)
              setErr(null)
            }}
            placeholder="Повторите"
            autoComplete="new-password"
            incomplete={Boolean(s2) && s1 !== s2}
            testId="mk-pass2"
          />
        </>
      )}

      {warnBanner}
      {errLine}
    </MkModal>
  ) : null

  /* ---------- Смена ключа ---------- */

  const changeModal = changing ? (
    <MkModal
      title="Смена ключа"
      sub="МАСТЕР-КЛЮЧ"
      onClose={resetForms}
      onSubmit={onChangeMaster}
      testId="mk-change-modal"
      footer={
        <>
          <button className="mk-cancel" type="button" onClick={resetForms} data-testid="mk-cancel">
            Отмена
          </button>
          <button
            className="mk-submit"
            type="submit"
            disabled={!curSecret || !next1}
            data-testid="mk-change-submit"
          >
            <IconKey width={13} height={13} aria-hidden="true" focusable="false" />
            Сменить ключ
          </button>
        </>
      }
    >
      <MkPassField
        id="sec-key-cur"
        label="Текущий ключ"
        value={curSecret}
        onChange={setCurSecret}
        autoComplete="current-password"
        inputRef={firstFieldRef}
        testId="mk-cur"
      />
      <MkPassField
        id="sec-key-next"
        label="Новый ключ"
        hint={lock.method === 'pin' ? '6 цифр' : 'min 8 chars'}
        value={next1}
        onChange={setNext1}
        autoComplete="new-password"
        testId="mk-next1"
      >
        {next1.length > 0 && (
          <div className={`lock-strength s${strengthPw(next1)}`} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
      </MkPassField>
      <MkPassField
        id="sec-key-rep2"
        label="Подтверждение"
        hint={next2 && next1 === next2 ? 'совпадает' : undefined}
        hintTone={next2 && next1 === next2 ? 'ok' : undefined}
        value={next2}
        onChange={setNext2}
        placeholder="Повторите новый"
        autoComplete="new-password"
        testId="mk-next2"
      />
      <p className="mk-note">
        Файловые ключи продолжат работать — они переупакуются автоматически.
      </p>
      {errLine}
    </MkModal>
  ) : null

  /* ---------- Выключение замка ---------- */

  const disableModal = disabling ? (
    <MkModal
      title="Выключить замок"
      sub="МАСТЕР-КЛЮЧ"
      danger
      onClose={resetForms}
      onSubmit={onDisable}
      testId="mk-disable-modal"
      footer={
        <>
          <button className="mk-cancel" type="button" onClick={resetForms} data-testid="mk-cancel">
            Отмена
          </button>
          <button
            className="mk-submit is-danger"
            type="submit"
            disabled={!disableSecret}
            data-testid="mk-disable-submit"
          >
            <IconAlertTri width={13} height={13} aria-hidden="true" focusable="false" />
            Выключить замок
          </button>
        </>
      }
    >
      <p className="mk-warn is-danger">
        <IconAlertTri width={14} height={14} aria-hidden="true" focusable="false" />
        <span>С замком стираются файловые ключи</span>
      </p>
      <MkPassField
        id="sec-key-disable"
        label="Подтверждение"
        value={disableSecret}
        onChange={setDisableSecret}
        placeholder="Текущим мастер-ключом"
        autoComplete="current-password"
        inputRef={firstFieldRef}
        testId="mk-disable-secret"
      />
      {errLine}
    </MkModal>
  ) : null

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

        <button
          className="lock-setup-btn"
          onClick={() => setCreating(true)}
          data-testid="mk-setup-open"
        >
          <IconLockRound width={13} height={13} aria-hidden="true" focusable="false" />
          Настроить мастер-ключ
        </button>

        {createModal}
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
          <span className="mask-flag">
            {lock.autoLockMin === 0 ? 'выключена' : `${lock.autoLockMin} мин`}
          </span>
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
      <div className="lock-actions row">
        <button className="lock-setup-btn inline" onClick={toggleChangeForm} data-testid="mk-change-open">
          Изменить мастер-ключ
        </button>
        <button className="lock-cancel" onClick={() => setDisabling(true)} data-testid="mk-disable-open">
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

      {changeModal}
      {disableModal}
    </section>
  )
}
