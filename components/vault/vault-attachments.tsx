'use client'

/* ============================================================
   ВЛОЖЕНИЯ ЗАПИСИ · маленькие файлы под AES-GCM ключом записи
   Файл шифруется в момент выбора, наружу не уходит; скачивание —
   расшифровка в память → Blob → мгновенно отозванный object URL.
   ============================================================ */

import { useRef, useState } from 'react'
import { IconDoc, IconPlus, IconTrash } from '@/components/icons'
import { useSecrets, ATTACH_MAX_BYTES, ATTACH_MAX_TOTAL } from '@/lib/secrets-store'
import type { SecretRecord } from '@/lib/secrets'

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} КБ`

export function VaultAttachments({ entry, readOnly }: { entry: SecretRecord; readOnly: boolean }) {
  const s = useSecrets()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const used = entry.attachments.reduce((n, a) => n + a.size, 0)

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    for (const file of Array.from(files)) {
      const err = await s.addAttachment(entry.id, file)
      if (err) {
        setError(err)
        break
      }
    }
    setBusy(false)
    if (input.current) input.current.value = ''
  }

  return (
    <div className="vt-att" data-testid="detail-attachments">
      <div className="vt-att-head">
        <span className="label-mono">
          Вложения · <b className="num">{entry.attachments.length}</b>
        </span>
        <span className="vt-att-used label-mono">
          {kb(used)} из {kb(ATTACH_MAX_TOTAL)}
        </span>
        <span className="grow" />
        {!readOnly && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => input.current?.click()}
            disabled={busy}
            title={`Зашифрованный файл до ${kb(ATTACH_MAX_BYTES)}`}
            data-testid="attach-add"
          >
            <IconPlus />
            {busy ? 'Шифрую…' : 'Файл'}
          </button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => void pick(e.target.files)}
          data-testid="attach-input"
        />
      </div>

      {entry.attachments.length === 0 ? (
        <p className="vt-note" data-testid="attach-empty">
          Файлов нет. Приложите скан документа, ключ или лицензию до {kb(ATTACH_MAX_BYTES)} —
          содержимое зашифруется AES-GCM ключом этой записи.
        </p>
      ) : (
        <ul className="vt-att-list">
          {entry.attachments.map((a) => (
            <li className="vt-att-row" key={a.id} data-testid={`attach-row-${a.id}`}>
              <span className="vt-att-ico" aria-hidden="true">
                <IconDoc />
              </span>
              <span className="vt-att-name ellipsis" title={a.name}>
                {a.name}
              </span>
              <span className="vt-att-size label-mono num">{kb(a.size)}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  setError(null)
                  const ok = await s.downloadAttachment(entry.id, a.id)
                  if (!ok) setError('Не удалось расшифровать файл — проверьте сеанс мастер-ключа.')
                }}
                title="Расшифровать и скачать"
                data-testid={`attach-get-${a.id}`}
              >
                Скачать
              </button>
              {!readOnly && (
                <button
                  className="vt-icon-btn danger"
                  onClick={() => s.removeAttachment(entry.id, a.id)}
                  title="Удалить вложение"
                  aria-label={`Удалить вложение ${a.name}`}
                  data-testid={`attach-del-${a.id}`}
                >
                  <IconTrash />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="vt-error" role="alert" data-testid="attach-error">
          {error}
        </p>
      )}
    </div>
  )
}
