'use client'

import { useState } from 'react'
import { useDialog } from '@/hooks/use-dialog'
import { IconAlertTri, IconClose } from './icons'

/** Подтверждение существующего resetLock; пароль аккаунта не затрагивается. */
export function ResetLockDialog({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  const { dialogProps } = useDialog<HTMLFormElement>({ onClose, label: 'Сброс мастер-ключа' })
  return (
    <div className="access-modal-back" onPointerDown={onClose} data-testid="reset-lock-backdrop">
      <form className="mk-card is-danger" {...dialogProps} onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (confirmation === 'СБРОСИТЬ') onReset() }} data-testid="reset-lock-modal">
        <header className="mk-head">
          <span className="mk-head-ico" aria-hidden="true"><IconAlertTri /></span>
          <div className="mk-head-text">
            <h2 className="mk-title" data-testid="reset-lock-title">Сброс мастер-ключа</h2>
            <p className="mk-sub" data-testid="reset-lock-description">Это не восстановление доступа</p>
          </div>
          <button className="mk-x" type="button" onClick={onClose} aria-label="Закрыть" data-testid="reset-lock-close"><IconClose /></button>
        </header>
        <div className="mk-body">
          <p className="mk-warn is-danger" data-testid="reset-lock-warning">Мастер-ключ и сохранённые файловые ключи будут удалены. Файлы останутся, но доступ к зашифрованным секретам и защищённому содержимому без прежних ключей будет потерян.</p>
          <div className="access-field">
            <label htmlFor="reset-lock-confirmation" data-testid="reset-lock-label">Для подтверждения введите СБРОСИТЬ</label>
            <input id="reset-lock-confirmation" className="access-input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} data-testid="reset-lock-confirmation" />
          </div>
        </div>
        <footer className="mk-foot">
          <button className="mk-cancel" type="button" onClick={onClose} data-testid="reset-lock-cancel">Отмена</button>
          <button className="mk-submit is-danger" type="submit" disabled={confirmation !== 'СБРОСИТЬ'} data-testid="reset-lock-submit">Сбросить ключ</button>
        </footer>
      </form>
    </div>
  )
}