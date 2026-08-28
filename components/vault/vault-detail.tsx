'use client'

/* ============================================================
   ПРАВАЯ КОЛОНКА · деталь записи
   Поля с [Показать]/[Копировать], TOTP с отсчётом, история, теги.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import {
  IconChevronDown,
  IconExternal,
  IconGridBoard,
  IconPencil,
  IconRefresh,
  IconTrash,
  iconOf,
} from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import {
  TYPE_HUE,
  TYPE_META,
  domainOf,
  fmtAgo,
  isExpired,
  type HistoryEntry,
  type SecretRecord,
} from '@/lib/secrets'
import { SecretValue } from './secret-value'
import { TotpCell } from './totp-cell'
import { VaultAttachments } from './vault-attachments'
import { WifiQr } from './wifi-qr'

export function VaultDetail({
  entry,
  now,
  onEdit,
}: {
  entry: SecretRecord | null
  now: number
  onEdit: () => void
}) {
  const s = useSecrets()
  const [histOpen, setHistOpen] = useState(false)
  const [qr, setQr] = useState(false)
  useEffect(() => {
    setHistOpen(false)
    setQr(false)
  }, [entry?.id])

  if (!entry) {
    return (
      <aside className="vt-detail panel" aria-label="Деталь записи">
        <p className="vt-note" data-testid="vault-detail-empty">
          Выберите запись слева — здесь появятся поля, TOTP и история изменений.
        </p>
      </aside>
    )
  }

  const domain = domainOf(entry)
  const expired = isExpired(entry, now)
  const folder = s.folders.find((f) => f.id === entry.folderId)
  const inTrash = entry.deletedAt !== null
  const TypeIcon = iconOf(TYPE_META[entry.type].icon)

  return (
    <aside className="vt-detail panel" aria-label="Деталь записи" data-testid="vault-detail">
      <header className="vt-detail-head">
        <span
          className="vt-detail-ico"
          aria-hidden="true"
          style={{ color: `hsl(${TYPE_HUE[entry.type]} 32% 70%)` }}
        >
          {entry.icon?.b64 ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={entry.icon.b64} alt="" width={20} height={20} />
          ) : (
            <TypeIcon />
          )}
        </span>
        <div className="vt-detail-titles">
          <h2 className="vt-detail-title ellipsis" data-testid="detail-title">
            {entry.title}
          </h2>
          <p className="vt-detail-sub mono">
            {TYPE_META[entry.type].label}
            {domain ? ` · ${domain}` : ''}
          </p>
        </div>
        <button
          className={`vt-icon-btn${entry.favorite ? ' on' : ''}`}
          onClick={() => s.toggleFavorite(entry.id)}
          title="В избранное"
          aria-pressed={entry.favorite}
          data-testid="detail-favorite"
        >
          <span className="vt-star">★</span>
        </button>
        {!inTrash && entry.type === 'wifi' && (
          <button
            className="vt-icon-btn"
            onClick={() => setQr(true)}
            title="QR-код для подключения к сети"
            aria-label="Показать QR-код Wi-Fi"
            data-testid="detail-wifi-qr"
          >
            <IconGridBoard />
          </button>
        )}
        {!inTrash && (
          <button className="vt-icon-btn" onClick={onEdit} title="Изменить" data-testid="detail-edit">
            <IconPencil />
          </button>
        )}
        {inTrash ? (
          <>
            <button
              className="vt-icon-btn"
              onClick={() => s.restoreEntry(entry.id)}
              title="Восстановить"
              data-testid="detail-restore"
            >
              <IconRefresh />
            </button>
            <button
              className="vt-icon-btn danger"
              onClick={() => s.purgeEntry(entry.id)}
              title="Удалить безвозвратно"
              data-testid="detail-purge"
            >
              <IconTrash />
            </button>
          </>
        ) : (
          <button
            className="vt-icon-btn danger"
            onClick={() => s.softDelete(entry.id)}
            title="В корзину"
            data-testid="detail-delete"
          >
            <IconTrash />
          </button>
        )}
      </header>

      {expired && (
        <p className="vt-warn" data-testid="detail-expired">
          Срок записи истёк {new Date(entry.expiredAfter ?? 0).toLocaleDateString('ru-RU')} — пора
          обновить значение.
        </p>
      )}

      <div className="vt-detail-fields">
        {entry.fields.map((f) => (
          <div className="vt-row" key={f.id}>
            <span className="vt-row-name label-mono">{f.name}</span>
            {f.kind === 'url' && f.value && !f.secret ? (
              <span className="vt-val">
                <a
                  className="vt-link mono ellipsis"
                  href={f.value.includes('://') ? f.value : `https://${f.value}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-testid={`detail-link-${f.id}`}
                >
                  {f.value}
                </a>
                <IconExternal />
              </span>
            ) : (
              <SecretValue entryId={entry.id} field={f} />
            )}
          </div>
        ))}
      </div>

      {entry.totp && (
        <div className="vt-row">
          <span className="vt-row-name label-mono">Authenticator</span>
          <TotpCell entryId={entry.id} period={entry.totp.period} />
        </div>
      )}

      <VaultAttachments entry={entry} readOnly={inTrash} />

      {!inTrash && entry.history.length > 0 && (
        <div className="vt-hist" data-testid="detail-history">
          <button
            className={`vt-hist-toggle label-mono${histOpen ? ' open' : ''}`}
            onClick={() => setHistOpen((o) => !o)}
            aria-expanded={histOpen}
            data-testid="detail-history-toggle"
          >
            <IconChevronDown />
            История изменений · <b className="num">{entry.history.length}</b>
          </button>
          {histOpen &&
            entry.history.map((h) => (
              <HistoryRow
                key={`${h.at}-${h.fieldId}`}
                entryId={entry.id}
                h={h}
                now={now}
                canRestore={entry.fields.some((f) => f.id === h.fieldId)}
              />
            ))}
        </div>
      )}

      <footer className="vt-detail-foot">
        {entry.tags.length > 0 && (
          <div className="vt-tags">
            {entry.tags.map((t) => (
              <span className="chip" key={t}>
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="vt-meta-grid label-mono">
          <span>Изменено</span>
          <b>{fmtAgo(entry.updatedAt, now)}</b>
          <span>Создано</span>
          <b>{new Date(entry.createdAt).toLocaleDateString('ru-RU')}</b>
          {folder && (
            <>
              <span>Папка</span>
              <b>{folder.name}</b>
            </>
          )}
          <span>История</span>
          <b className="num">{entry.history.length} снапшотов</b>
        </div>
        <p className="vt-note">
          Секретные поля лежат зашифрованными (AES-GCM). Показ гаснет сам, буфер очищается по
          таймауту. ИИ-чат к этой записи доступа не имеет.
        </p>
      </footer>

      {qr && <WifiQr entry={entry} onClose={() => setQr(false)} />}
    </aside>
  )
}

/** Строка истории: дата, скрытое прежнее значение, показ с автогашением, откат. */
function HistoryRow({
  entryId,
  h,
  now,
  canRestore,
}: {
  entryId: string
  h: HistoryEntry
  now: number
  canRestore: boolean
}) {
  const s = useSecrets()
  const [shown, setShown] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setShown(null), [s.hideEpoch])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function toggle() {
    if (shown !== null) {
      setShown(null)
      return
    }
    const plain = await s.openCipher(entryId, h.prevCt)
    if (plain === null) return
    setShown(plain)
    const secs = Math.max(1, Math.round(Number(s.settings.revealSeconds) || 8))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShown(null), secs * 1000)
  }

  return (
    <div className="vt-hist-row" data-testid={`history-row-${h.at}`}>
      <span className="vt-hist-name label-mono ellipsis">{h.fieldName}</span>
      <span className="vt-hist-at label-mono">{fmtAgo(h.at, now)}</span>
      <code className={`vt-hist-val mono ellipsis${shown !== null ? ' open' : ''}`}>
        {shown ?? '••••••••'}
      </code>
      <button
        className="btn btn-ghost btn-sm"
        onClick={toggle}
        title={shown !== null ? 'Скрыть' : 'Показать прежнее значение'}
        data-testid={`history-reveal-${h.at}`}
      >
        {shown !== null ? 'Скрыть' : 'Показать'}
      </button>
      {canRestore && (
        <button
          className="btn btn-ghost btn-sm vt-hist-restore"
          onClick={() => s.restoreHistory(entryId, h.at, h.fieldId)}
          title="Вернуть это значение полю (текущее уйдёт в историю)"
          data-testid={`history-restore-${h.at}`}
        >
          Вернуть
        </button>
      )}
    </div>
  )
}
