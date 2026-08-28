'use client'

/* ============================================================
   РЕДАКТОР ЗАПИСИ · draft/save/revert, конструктор полей
   Значения секретных полей приходят расшифрованными только сюда
   и уходят обратно в сейф уже как ct:iv (никуда больше).
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
import { IconClose, IconPlus, IconSparkText, IconTrash } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import {
  TYPE_META,
  TYPE_ORDER,
  type FieldKind,
  type SecretRecord,
  type SecretType,
} from '@/lib/secrets'
import { parseOtpauth } from '@/lib/secrets-totp'
import { scorePassword } from '@/lib/secrets-gen'
import { VaultGenerator } from './vault-generator'

type Draft = { id?: string; name: string; kind: FieldKind; value: string; secret: boolean }

const KINDS: { id: FieldKind; label: string }[] = [
  { id: 'text', label: 'текст' },
  { id: 'password', label: 'пароль' },
  { id: 'secret', label: 'секрет' },
  { id: 'url', label: 'ссылка' },
  { id: 'email', label: 'email' },
  { id: 'number', label: 'число' },
  { id: 'date', label: 'дата' },
  { id: 'multiline', label: 'текст многострочный' },
  { id: 'boolean', label: 'да/нет' },
]

export function VaultEditor({
  entry,
  initialType,
  folderId,
  onClose,
}: {
  entry: SecretRecord | null
  initialType: SecretType
  folderId: string | null
  onClose: (savedId?: string) => void
}) {
  const s = useSecrets()
  const [type, setType] = useState<SecretType>(entry?.type ?? initialType)
  const [title, setTitle] = useState(entry?.title ?? '')
  const [tags, setTags] = useState((entry?.tags ?? []).join(', '))
  const [folder, setFolder] = useState<string | null>(entry?.folderId ?? folderId)
  const [favorite, setFavorite] = useState(entry?.favorite ?? false)
  const [expires, setExpires] = useState(
    entry?.expiredAfter ? new Date(entry.expiredAfter).toISOString().slice(0, 10) : '',
  )
  const [fields, setFields] = useState<Draft[]>([])
  const [totp, setTotp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [genFor, setGenFor] = useState<number | null>(null)
  const [loading, setLoading] = useState(entry !== null)

  /* Существующая запись: тянем расшифрованные значения. */
  useEffect(() => {
    let alive = true
    if (!entry) {
      setFields(
        TYPE_META[initialType].fields.map((f) => ({
          name: f.name,
          kind: f.kind,
          value: '',
          secret: f.secret === true,
        })),
      )
      return
    }
    void (async () => {
      const opened = await s.openEntry(entry.id)
      const secret = entry.totp ? await s.openTotpSecret(entry.id) : null
      if (!alive) return
      setFields(
        entry.fields.map((f) => ({
          id: f.id,
          name: f.name,
          kind: f.kind,
          value: opened?.[f.id] ?? '',
          secret: f.secret,
        })),
      )
      setTotp(secret ?? '')
      setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id])

  /* Смена типа у новой записи перезаливает шаблон полей. */
  function switchType(next: SecretType) {
    setType(next)
    if (entry) return
    setFields(
      TYPE_META[next].fields.map((f) => ({
        name: f.name,
        kind: f.kind,
        value: '',
        secret: f.secret === true,
      })),
    )
  }

  const strengthOf = useMemo(
    () => (value: string) => scorePassword(value),
    [],
  )

  function patch(i: number, next: Partial<Draft>) {
    setFields((all) => all.map((f, k) => (k === i ? { ...f, ...next } : f)))
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('Название обязательно')
      return
    }
    setSaving(true)
    const tagList = tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12)
    const expiredAfter = expires ? new Date(`${expires}T00:00:00`).getTime() : null
    const cleaned = fields
      .filter((f) => f.name.trim())
      .map((f) => ({ ...f, name: f.name.trim().slice(0, 60) }))

    const totpValue = totp.trim() ? (parseOtpauth(totp.trim())?.secret ?? totp.trim().toUpperCase()) : null

    const err = entry
      ? await s.updateEntry(entry.id, {
          title,
          tags: tagList,
          folderId: folder,
          favorite,
          expiredAfter,
          fields: cleaned,
          totpSecret: TYPE_META[type].totp ? totpValue : null,
        })
      : await s.createEntry(
          type,
          title,
          cleaned,
          { tags: tagList, folderId: folder, favorite, expiredAfter },
          TYPE_META[type].totp ? totpValue : null,
        )
    setSaving(false)
    if (err) {
      setError(err)
      return
    }
    onClose(entry?.id)
  }

  return (
    <div className="vt-modal-back" role="presentation" onPointerDown={() => onClose()}>
      <div
        className="vt-modal panel vt-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={entry ? 'Изменить запись' : 'Новая запись'}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid="entry-editor"
      >
        <header className="vt-modal-head">
          <span className="label-mono">{entry ? 'Изменить запись' : 'Новая запись'}</span>
          <button className="vt-icon-btn" onClick={() => onClose()} aria-label="Закрыть" data-testid="editor-close">
            <IconClose />
          </button>
        </header>

        {loading ? (
          <p className="vt-note">Расшифровываю значения…</p>
        ) : (
          <div className="vt-form">
            {!entry && (
              <div className="vt-chip-row" role="radiogroup" aria-label="Тип записи">
                {TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={type === t}
                    className={`chip${type === t ? ' on' : ''}`}
                    onClick={() => switchType(t)}
                    title={TYPE_META[t].note}
                    data-testid={`editor-type-${t}`}
                  >
                    {TYPE_META[t].label}
                  </button>
                ))}
              </div>
            )}

            <label className="vt-field">
              <span className="label-mono">Название</span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="GitHub"
                autoComplete="off"
                data-testid="editor-title"
              />
            </label>

            <div className="vt-field-row">
              <label className="vt-field">
                <span className="label-mono">Теги через запятую</span>
                <input
                  className="input"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="work, dev"
                  autoComplete="off"
                  data-testid="editor-tags"
                />
              </label>
              <label className="vt-field">
                <span className="label-mono">Папка</span>
                <select
                  className="input"
                  value={folder ?? ''}
                  onChange={(e) => setFolder(e.target.value || null)}
                  data-testid="editor-folder"
                >
                  <option value="">Без папки</option>
                  {s.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="vt-field">
                <span className="label-mono">Истекает</span>
                <input
                  className="input"
                  type="date"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                  data-testid="editor-expires"
                />
              </label>
            </div>

            <div className="vt-fields">
              {fields.map((f, i) => (
                <div className="vt-field-edit" key={f.id ?? `new-${i}`}>
                  <input
                    className="input vt-field-name"
                    value={f.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                    aria-label="Имя поля"
                    data-testid={`editor-field-name-${i}`}
                  />
                  <select
                    className="input vt-field-kind"
                    value={f.kind}
                    onChange={(e) => {
                      const kind = e.target.value as FieldKind
                      patch(i, { kind, secret: kind === 'password' || kind === 'secret' ? true : f.secret })
                    }}
                    aria-label="Тип поля"
                    data-testid={`editor-field-kind-${i}`}
                  >
                    {KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  {f.kind === 'multiline' ? (
                    <textarea
                      className="input vt-field-value"
                      rows={3}
                      value={f.value}
                      onChange={(e) => patch(i, { value: e.target.value })}
                      aria-label={f.name}
                      data-testid={`editor-field-value-${i}`}
                    />
                  ) : (
                    <input
                      className="input vt-field-value"
                      type={f.secret ? 'password' : f.kind === 'date' ? 'date' : 'text'}
                      value={f.value}
                      onChange={(e) => patch(i, { value: e.target.value })}
                      autoComplete="off"
                      aria-label={f.name}
                      data-testid={`editor-field-value-${i}`}
                    />
                  )}
                  <button
                    className={`vt-icon-btn${f.secret ? ' on' : ''}`}
                    title={f.secret ? 'Секретное поле (шифруется)' : 'Открытое поле'}
                    aria-pressed={f.secret}
                    onClick={() => patch(i, { secret: !f.secret })}
                    data-testid={`editor-field-secret-${i}`}
                  >
                    <span className="label-mono">ct</span>
                  </button>
                  <button
                    className="vt-icon-btn"
                    title="Сгенерировать значение"
                    onClick={() => setGenFor(i)}
                    data-testid={`editor-field-gen-${i}`}
                  >
                    <IconSparkText />
                  </button>
                  <button
                    className="vt-icon-btn danger"
                    title="Удалить поле"
                    onClick={() => setFields((all) => all.filter((_, k) => k !== i))}
                    data-testid={`editor-field-del-${i}`}
                  >
                    <IconTrash />
                  </button>
                  {f.secret && f.value && (
                    <span className={`vt-mini-strength s${strengthOf(f.value).score}`}>
                      {strengthOf(f.value).label} · <b className="num">{strengthOf(f.value).bits}</b> бит
                    </span>
                  )}
                </div>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setFields((all) => [...all, { name: 'Своё поле', kind: 'text', value: '', secret: false }])
                }
                data-testid="editor-add-field"
              >
                <IconPlus />
                Добавить поле
              </button>
            </div>

            {TYPE_META[type].totp && (
              <label className="vt-field">
                <span className="label-mono">TOTP: Base32-секрет или otpauth:// ссылка</span>
                <input
                  className="input mono"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  placeholder="JBSWY3DPEHPK3PXP"
                  autoComplete="off"
                  data-testid="editor-totp"
                />
              </label>
            )}

            <div className="vt-form-row">
              <button
                className={`chip${favorite ? ' on' : ''}`}
                aria-pressed={favorite}
                onClick={() => setFavorite((x) => !x)}
                data-testid="editor-favorite"
              >
                ★ Избранное
              </button>
              <span className="vt-note">
                Секретные поля (ct) шифруются AES-GCM ключом записи, выведенным из ключа сейфа.
              </span>
            </div>

            {error && (
              <p className="vt-error" role="alert" data-testid="editor-error">
                {error}
              </p>
            )}
          </div>
        )}

        <footer className="vt-modal-foot">
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={() => onClose()} data-testid="editor-cancel">
            Отмена
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={saving || loading}
            data-testid="editor-save"
          >
            {saving ? 'Шифрую…' : 'Сохранить'}
          </button>
        </footer>
      </div>

      {genFor !== null && (
        <VaultGenerator
          onUse={(value) => patch(genFor, { value })}
          onClose={() => setGenFor(null)}
        />
      )}
    </div>
  )
}
