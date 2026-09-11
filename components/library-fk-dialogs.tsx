'use client'

/* ============================================================
   БИБЛИОТЕКА · МОДАЛКИ ФАЙЛОВЫХ КЛЮЧЕЙ (FILE-KEYS v3.2b)
   Ввод ключа для запертого файла и установка нового ключа.
   Вынесено из screen-library.tsx без изменения поведения.
   ============================================================ */

import { IconKey, IconLockRound } from './icons'
import { PasswordInput } from './password-input'
import { DialogShell } from '@/components/dialog-shell'

export function FileKeyAskDialog({
  fileName,
  value,
  error,
  cooling,
  onValue,
  onError,
  onSubmit,
  onClose,
}: {
  fileName: string
  value: string
  error: string | null
  /** Пауза после неудачных попыток: поле и кнопка выключены. */
  cooling: boolean
  onValue: (v: string) => void
  onError: (v: string | null) => void
  onSubmit: () => void
  onClose: () => void
}) {
  return (
    <DialogShell className="fk-modal" label="Файловый ключ" testId="fk-ask-modal" onClose={onClose}>
      <div className="lock-card">
        <div className="lk-head" data-testid="fk-ask-title">
          <IconKey width={12} height={12} aria-hidden="true" focusable="false" />
          Файл защищён паролем
        </div>
        <div className="file-name" data-testid="fk-ask-filename">{fileName}</div>
        <div className="lock-form">
          <label className="access-hint" htmlFor="file-unlock-password" data-testid="fk-ask-label">Пароль файла</label>
          <PasswordInput
            id="file-unlock-password"
            className={`lock-input mono${error ? ' err' : ''}`}
            autoFocus
            testId="fk-ask-input"
            value={value}
            disabled={cooling}
            onChange={(e) => {
              onValue(e.target.value)
              if (error) onError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSubmit()
            }}
            placeholder="Введите пароль"
            aria-label="Ключ файла"
            aria-invalid={!!error}
          />
          <span className={`key-hint mono${error ? ' err' : ''}`} role="status" data-testid="fk-ask-hint">
            {error ??
              (cooling
                ? 'Подождите перед следующей попыткой.'
                : 'Введите пароль, заданный для этого файла.')}
          </span>
        </div>
        <div className="fk-modal-row">
          <button
            className="btn btn-primary btn-sm"
            data-testid="fk-ask-submit"
            onClick={onSubmit}
            disabled={!value.trim() || cooling}
          >
            <IconKey />
            Открыть
          </button>
          <button className="btn btn-ghost btn-sm" data-testid="fk-ask-cancel" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

export function FileKeySetDialog({
  fileName,
  pass1,
  pass2,
  error,
  onPass1,
  onPass2,
  onError,
  onSave,
  onClose,
}: {
  fileName: string
  pass1: string
  pass2: string
  error: string | null
  onPass1: (v: string) => void
  onPass2: (v: string) => void
  onError: (v: string | null) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <DialogShell className="fk-modal" label="Новый файловый ключ" testId="fk-set-modal" onClose={onClose}>
      <div className="lock-card">
        <div className="lk-head" data-testid="fk-set-title">
          <IconLockRound width={12} height={12} aria-hidden="true" focusable="false" />
          Установить пароль файла
        </div>
        <div className="file-name" data-testid="fk-set-filename">{fileName}</div>
        <p className="fk-note" data-testid="fk-set-warning">
          Пароль защищает описание файла. Сброс мастер-ключа удалит файловые ключи и доступ к защищённому описанию.
        </p>
        <div className="lock-form">
          <label className="access-hint" htmlFor="file-new-password" data-testid="fk-set-pass1-label">Новый пароль</label>
          <PasswordInput
            id="file-new-password"
            className={`lock-input mono${error ? ' err' : ''}`}
            autoFocus
            testId="fk-set-pass1"
            autoComplete="new-password"
            value={pass1}
            onChange={(e) => {
              onPass1(e.target.value)
              if (error) onError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSave()
            }}
            placeholder="Не менее 8 символов"
            aria-label="Новый ключ файла"
            aria-invalid={!!error}
          />
          <label className="access-hint" htmlFor="file-repeat-password" data-testid="fk-set-pass2-label">Повторите пароль</label>
          <PasswordInput
            id="file-repeat-password"
            className={`lock-input mono${error ? ' err' : ''}`}
            testId="fk-set-pass2"
            autoComplete="new-password"
            value={pass2}
            onChange={(e) => {
              onPass2(e.target.value)
              if (error) onError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSave()
            }}
            placeholder="Тот же пароль ещё раз"
            aria-label="Повторите ключ файла"
          />
          <span className={`key-hint mono${error ? ' err' : ''}`} role="status" data-testid="fk-set-hint">
            {error ?? 'описание файла будет зашифровано этим ключом'}
          </span>
        </div>
        <div className="fk-modal-row">
          <button className="btn btn-primary btn-sm" data-testid="fk-set-save" onClick={onSave}>
            <IconLockRound width={13} height={13} stroke="currentColor" strokeWidth={1.6} />
            Установить пароль
          </button>
          <button className="btn btn-ghost btn-sm" data-testid="fk-set-cancel" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
