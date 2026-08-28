'use client'

/* ============================================================
   ЦЕНТРАЛЬНАЯ КОЛОНКА · карточки записей
   Значения всегда маскированы: список не расшифровывает ничего.
   ============================================================ */

import { useEffect } from 'react'
import { iconOf } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import {
  TYPE_HUE,
  TYPE_META,
  domainOf,
  fmtAgo,
  isExpired,
  type SecretRecord,
} from '@/lib/secrets'

export function VaultList({
  entries,
  selId,
  onSelect,
  now,
  trashMode,
}: {
  entries: SecretRecord[]
  selId: string | null
  onSelect: (id: string) => void
  now: number
  trashMode: boolean
}) {
  const s = useSecrets()

  /* Иконки сайтов подтягиваются только при показе карточки и только если
     тумблер включён. Наружу уходит домен, в DOM — локальный b64. */
  useEffect(() => {
    if (!s.settings.favicons) return
    entries.slice(0, 30).forEach((e) => void s.loadIcon(e.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, s.settings.favicons])

  if (entries.length === 0) {
    return (
      <div className="vt-list-empty panel" data-testid="vault-list-empty">
        <p className="vt-empty-title">{trashMode ? 'Корзина пуста' : 'Здесь пока ничего нет'}</p>
        <p className="vt-note">
          {trashMode
            ? 'Удалённые записи попадают сюда и ждут безвозвратного удаления.'
            : 'Создайте первую запись кнопкой «Новая запись» или импортируйте экспорт из другого менеджера.'}
        </p>
      </div>
    )
  }

  return (
    <div className="vt-list" role="listbox" aria-label="Записи сейфа" data-testid="vault-list">
      {entries.map((e) => {
        const Icon = iconOf(TYPE_META[e.type].icon)
        const domain = domainOf(e)
        const expired = isExpired(e, now)
        const secretCount = e.fields.filter((f) => f.secret && f.value).length
        return (
          <button
            key={e.id}
            role="option"
            aria-selected={selId === e.id}
            className={`vt-card${selId === e.id ? ' on' : ''}`}
            onClick={() => onSelect(e.id)}
            data-testid={`vault-card-${e.id}`}
          >
            <span
              className="vt-card-icon"
              aria-hidden="true"
              style={{ color: `hsl(${TYPE_HUE[e.type]} 32% 70%)` }}
            >
              {e.icon?.b64 ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={e.icon.b64} alt="" width={18} height={18} />
              ) : (
                <Icon />
              )}
            </span>
            <span className="vt-card-text">
              <span className="vt-card-title ellipsis">{e.title}</span>
              <span className="vt-card-sub ellipsis mono">
                {domain ?? TYPE_META[e.type].label}
                {secretCount > 0 ? ` · ${'•'.repeat(Math.min(8, secretCount * 4))}` : ''}
              </span>
            </span>
            {e.favorite && <span className="vt-star" aria-label="В избранном">★</span>}
            {e.totp && <span className="badge badge-info">TOTP</span>}
            {expired && (
              <span className="badge badge-danger" data-testid={`badge-expired-${e.id}`}>
                EXPIRED
              </span>
            )}
            <span className="vt-card-meta label-mono">
              {trashMode ? 'в корзине' : fmtAgo(e.updatedAt, now)}
            </span>
            <span className="vt-card-kind" aria-hidden="true">
              <Icon />
            </span>
          </button>
        )
      })}
    </div>
  )
}
