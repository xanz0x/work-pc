'use client'

/* ============================================================
   ЦЕНТРАЛЬНАЯ КОЛОНКА · карточки записей
   Значения всегда маскированы: список не расшифровывает ничего.
   NF-5: карточка умеет быть выбранной. Обычный клик открывает запись,
   Ctrl/Cmd+клик добавляет её к выделению, Shift+клик берёт диапазон
   от предыдущей отметки — как в файловом менеджере.
   ============================================================ */

import { useEffect } from 'react'
import { IconCheck, iconOf } from '@/components/icons'
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
  marked,
  selectMode = false,
  onMark,
}: {
  entries: SecretRecord[]
  selId: string | null
  onSelect: (id: string) => void
  now: number
  trashMode: boolean
  /** NF-5: отмеченные записи; пустое множество = выделения нет. */
  marked?: ReadonlySet<string>
  selectMode?: boolean
  /** NF-5: клик с модификатором или в режиме выбора. */
  onMark?: (id: string, mods: { range: boolean; toggle: boolean }) => void
}) {
  const s = useSecrets()
  const markedSet = marked ?? EMPTY_SET

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
        const isMarked = markedSet.has(e.id)
        return (
          <button
            key={e.id}
            role="option"
            aria-selected={selId === e.id}
            className={`vt-card${selId === e.id ? ' on' : ''}${isMarked ? ' marked' : ''}${
              selectMode ? ' pickable' : ''
            }`}
            onClick={(ev) => {
              const toggle = ev.metaKey || ev.ctrlKey || selectMode
              const range = ev.shiftKey
              if (onMark && (toggle || range)) {
                onMark(e.id, { range, toggle })
                return
              }
              onSelect(e.id)
            }}
            data-testid={`vault-card-${e.id}`}
            data-marked={isMarked ? '1' : undefined}
          >
            {(selectMode || markedSet.size > 0) && (
              <span
                className={`vt-mark${isMarked ? ' on' : ''}`}
                aria-hidden="true"
                data-testid={`vault-mark-${e.id}`}
              >
                {isMarked ? <IconCheck width={11} height={11} stroke="currentColor" strokeWidth={2} /> : null}
              </span>
            )}
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

const EMPTY_SET: ReadonlySet<string> = new Set<string>()
