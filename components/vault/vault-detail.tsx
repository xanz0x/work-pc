'use client'

/* ============================================================
   ПРАВАЯ КОЛОНКА · деталь записи
   Поля с [Показать]/[Копировать], TOTP с отсчётом, история, теги.
   ============================================================ */

import { IconExternal, IconPencil, IconRefresh, IconTrash } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import { TYPE_META, domainOf, fmtAgo, isExpired, type SecretRecord } from '@/lib/secrets'
import { SecretValue } from './secret-value'
import { TotpCell } from './totp-cell'

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

  return (
    <aside className="vt-detail panel" aria-label="Деталь записи" data-testid="vault-detail">
      <header className="vt-detail-head">
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
    </aside>
  )
}
