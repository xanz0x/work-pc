'use client'

import { useState, type InputHTMLAttributes, type Ref } from 'react'
import { IconEye, IconEyeOff } from './icons'

/** Единое поле пароля. Значение, автозаполнение и обработчики принадлежат форме. */
export function PasswordInput({
  testId,
  inputRef,
  wrapperClassName = '',
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  testId: string
  inputRef?: Ref<HTMLInputElement>
  wrapperClassName?: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className={`access-password ${wrapperClassName}`} data-testid={`${testId}-field`}>
      <input {...inputProps} ref={inputRef} type={shown ? 'text' : 'password'} data-testid={testId} />
      <button
        type="button"
        className="access-eye"
        aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={shown}
        disabled={inputProps.disabled}
        onClick={() => setShown((value) => !value)}
        data-testid={`${testId}-eye`}
      >
        {shown ? <IconEyeOff /> : <IconEye />}
      </button>
    </div>
  )
}