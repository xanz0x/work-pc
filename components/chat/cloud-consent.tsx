'use client'

import { IconShield, IconClose } from '../icons'
import { useDialog } from '@/hooks/use-dialog'

/**
 * Согласие на облачный ход. Показывается один раз: пока пользователь не
 * увидел список того, что уйдёт наружу, ни один запрос в облако не идёт.
 */
export function CloudConsent({
  model,
  fileNames,
  sendIndex,
  onAccept,
  onCancel,
  onDisableIndex,
}: {
  model: string
  fileNames: number
  sendIndex: boolean
  onAccept: () => void
  onCancel: () => void
  onDisableIndex: () => void
}) {
  const dialog = useDialog({ onClose: onCancel, label: 'Согласие на облачный запрос' })
  return (
    <div className="consent-veil">
      <div className="consent-card panel" {...dialog.dialogProps} data-testid="cloud-consent">
        <header className="consent-head">
          <span className="consent-mark" aria-hidden="true">
            <IconShield />
          </span>
          <div>
            <h2 className="consent-title">Запрос уйдёт во внешнюю модель</h2>
            <p className="consent-sub mono">{model}</p>
          </div>
          <span className="grow" />
          <button
            type="button"
            className="icon-btn"
            onClick={onCancel}
            aria-label="Отменить"
            data-testid="cloud-consent-close"
          >
            <IconClose />
          </button>
        </header>

        <p className="consent-note">Наружу уйдёт ровно это:</p>
        <ul className="consent-list">
          <li>текст вашего запроса и история этого диалога;</li>
          <li>
            {sendIndex
              ? `индекс сейфа: имена, категории и теги — ${fileNames} ${fileNames === 1 ? 'файла' : 'файлов'};`
              : 'индекс и имена закреплённых файлов не отправляются;'}
          </li>
          <li>результаты разрешённых навыков, включая адреса ящиков; перед чтением писем появится отдельное подтверждение.</li>
        </ul>
        <p className="consent-note consent-dim">
          Существующие секреты и мастер-ключ не читаются. Новый пароль генератора остаётся в браузере. Но всё, что вы сами вставите в сообщение, попадёт в историю и во внешнюю модель.
        </p>

        <footer className="consent-foot">
          {sendIndex ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onDisableIndex}
              data-testid="cloud-consent-no-index"
            >
              Не отправлять индекс
            </button>
          ) : null}
          <span className="grow" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} data-testid="cloud-consent-cancel">
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAccept}
            data-testid="cloud-consent-accept"
          >
            Согласен, отправить
          </button>
        </footer>
      </div>
    </div>
  )
}
