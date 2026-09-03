'use client'

/* Поля мастер-ключа: одна реализация на настройки и онбординг. */

import { useState, type ReactNode } from 'react'
import { IconEye, IconEyeOff } from './icons'

/** PIN ровно из шести цифр — единое правило для всех экранов. */
export const PIN_LENGTH = 6

/** Грубая оценка силы пароля: 0…4 полоски. */
export function strengthPw(pw: string): number {
  let n = 0
  if (pw.length >= 8) n++
  if (pw.length >= 12) n++
  if (/\d/.test(pw) && /[a-zA-Zа-яА-Я]/.test(pw)) n++
  if (/[^a-zA-Z0-9а-яА-Я]/.test(pw)) n++
  return Math.min(n, 4)
}

/** Поле ключа: подпись со счётчиком справа, поле и глаз. */
export function MkPassField({
  id,
  label,
  hint,
  hintTone,
  value,
  onChange,
  placeholder,
  autoComplete,
  inputRef,
  testId,
  incomplete,
  onKeyDown,
  children,
}: {
  id: string
  label: string
  hint?: string
  hintTone?: 'ok' | 'bad'
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete: string
  inputRef?: React.Ref<HTMLInputElement>
  testId: string
  incomplete?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  children?: ReactNode
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="mk-field">
      <label className="label-mono mk-label" htmlFor={id}>
        <span>{label}</span>
        {hint ? (
          <span className={`mk-hint num${hintTone ? ` mk-hint-${hintTone}` : ''}`}>{hint}</span>
        ) : null}
      </label>
      <div className="mk-input-wrap">
        <input
          ref={inputRef}
          id={id}
          className={`lock-input mk-input num${incomplete ? ' is-incomplete' : ''}`}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          data-testid={testId}
        />
        <button
          className="mk-eye"
          type="button"
          onClick={() => setShown((x) => !x)}
          aria-label={shown ? 'Скрыть ключ' : 'Показать ключ'}
          aria-pressed={shown}
          data-testid={`${testId}-eye`}
        >
          {shown ? <IconEye /> : <IconEyeOff />}
        </button>
      </div>
      {children}
    </div>
  )
}

/** Шесть ячеек PIN: подпись со счётчиком, автоперевод фокуса. */
export function MkPinRow({
  idBase,
  label,
  hint,
  hintTone,
  value,
  onChange,
  hasError,
  firstRef,
  testId,
}: {
  idBase: string
  label: string
  hint: string
  hintTone?: 'ok' | 'bad'
  value: string
  onChange: (v: string) => void
  hasError: boolean
  firstRef?: React.Ref<HTMLInputElement>
  testId: string
}) {
  return (
    <div className="mk-field">
      <label className="label-mono mk-label" htmlFor={idBase}>
        <span>{label}</span>
        <span className={`mk-hint num${hintTone ? ` mk-hint-${hintTone}` : ''}`}>{hint}</span>
      </label>
      <div className={`lock-cells mk-cells${hasError ? ' has-error' : ''}`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <input
            key={i}
            id={i === 0 ? idBase : undefined}
            ref={i === 0 ? firstRef : undefined}
            className={`lock-cell num${value[i] ? ' filled' : ''}`}
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            value={value[i] ?? ''}
            onChange={(e) => {
              const ch = e.target.value.replace(/\D/g, '').slice(-1)
              onChange((value.slice(0, i) + ch + value.slice(i + 1)).slice(0, PIN_LENGTH))
              if (ch && i < PIN_LENGTH - 1) {
                const el = e.currentTarget.parentElement?.children[i + 1] as
                  | HTMLInputElement
                  | undefined
                el?.focus()
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !value[i] && i > 0) {
                const el = e.currentTarget.parentElement?.children[i - 1] as
                  | HTMLInputElement
                  | undefined
                el?.focus()
              }
            }}
            aria-label={`${label} — цифра ${i + 1}`}
            data-testid={`${testId}-${i}`}
          />
        ))}
      </div>
    </div>
  )
}
