'use client'

/* ============================================================
   РЕДАКТОР ЗАПИСИ · draft/save/revert, конструктор полей
   v1.1: компактная компоновка «Графит» — тип с иконками, дата
   в формате ДД.ММ.ГГГГ (без нативного календаря), поля-карточки
   с явным тумблером ct. Значения секретных полей приходят
   расшифрованными только сюда и уходят обратно как ct:iv.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
import { IconClose, IconLock, IconPlus, IconSparkText, IconTrash, iconOf } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import { VtSelect } from './vt-select'
import {
  TYPE_META,
  TYPE_ORDER,
  parseRuDate,
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
  { id: 'multiline', label: 'многострочный' },
  { id: 'boolean', label: 'да/нет' },
]

/* Короткие подписи для компактной сетки типов (полное имя — в title). */
const SHORT: Record<SecretType, string> = {
  login: 'Пароль',
  api: 'API-ключ',
  seed: 'Seed',
  card: 'Карта',
  ssh: 'SSH',
  note: 'Заметка',
  recovery: 'Коды',
  wifi: 'Wi-Fi',
  license: 'Лицензия',
  identity: 'Личные',
  'passkey-meta': 'Passkey',
  custom: 'Своя',
}

/** ДД.ММ.ГГГГ по мере ввода: точки ставятся сами, лишнее отбрасывается. */
function maskRuDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`
}

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
    entry?.expiredAfter ? new Date(entry.expiredAfter).toLocaleDateString('ru-RU') : '',
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

  const strengthOf = useMemo(() => (value: string) => scorePassword(value), [])
  const expiresBad = expires.trim() !== '' && parseRuDate(expires) === null

  function patch(i: number, next: Partial<Draft>) {
    setFields((all) => all.map((f, k) => (k === i ? { ...f, ...next } : f)))
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('Название обязательно')
      return
    }
    const expiredAfter = expires.trim() ? parseRuDate(expires) : null
    if (expires.trim() && expiredAfter === null) {
      setError('Дата истечения — в формате ДД.ММ.ГГГГ, например 31.12.2026')
      return
    }
    setSaving(true)
    const tagList = tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12)
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

  const TypeIcon = iconOf(TYPE_META[type].icon)

  return (
    <div className="vt-modal-back" role="presentation" onPointerDown={() => onClose()}>
      <div
        className="vt-modal panel vt-editor"
        role="dialog"
        aria-modal="true"
        aria-label={entry ? 'Изменить запись' : 'Новая запись'}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid="entry-editor"
      >
        <header className="vt-modal-head">
          <span className="label-mono">{entry ? 'Изменить запись' : 'Новая запись'}</span>
          <span className="vt-ed-type label-mono">{TYPE_META[type].label}</span>
          <button className="vt-icon-btn" onClick={() => onClose()} aria-label="Закрыть" data-testid="editor-close">
            <IconClose />
          </button>
        </header>

        {loading ? (
          <p className="vt-note">Расшифровываю значения…</p>
        ) : (
          <div className="vt-form">
            {!entry && (
              <div className="vt-type-grid" role="radiogroup" aria-label="Тип записи">
                {TYPE_ORDER.map((t) => {
                  const Icon = iconOf(TYPE_META[t].icon)
                  return (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={type === t}
                      className={`vt-type${type === t ? ' on' : ''}`}
                      onClick={() => switchType(t)}
                      title={`${TYPE_META[t].label} — ${TYPE_META[t].note}`}
                      data-testid={`editor-type-${t}`}
                    >
                      <Icon />
                      <span>{SHORT[t]}</span>
                    </button>
                  )
                })}
              </div>
            )}

            <label className="vt-field">
              <span className="label-mono">Название</span>
              <div className="vt-ed-title-row">
                <span className="vt-ed-ico" aria-hidden="true">
                  <TypeIcon />
                </span>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="GitHub"
                  autoComplete="off"
                  data-testid="editor-title"
                />
                <button
                  className={`vt-fav${favorite ? ' on' : ''}`}
                  aria-pressed={favorite}
                  title={favorite ? 'Убрать из избранного' : 'В избранное'}
                  onClick={() => setFavorite((x) => !x)}
                  data-testid="editor-favorite"
                >
                  ★
                </button>
              </div>
            </label>

            <div className="vt-field-row">
              <label className="vt-field">
                <span className="label-mono">Папка</span>
                <VtSelect
                  value={folder ?? ''}
                  onChange={(v) => setFolder(v || null)}
                  ariaLabel="Папка"
                  testId="editor-folder"
                  options={[
                    { value: '', label: 'Без папки' },
                    ...s.folders.map((f) => ({ value: f.id, label: f.name })),
                  ]}
                />
              </label>
              <label className="vt-field">
                <span className={`label-mono${expiresBad ? ' vt-bad' : ''}`}>
                  Истекает · дд.мм.гггг
                </span>
                <input
                  className={`input mono${expiresBad ? ' vt-input-bad' : ''}`}
                  value={expires}
                  inputMode="numeric"
                  onChange={(e) => setExpires(maskRuDate(e.target.value))}
                  placeholder="31.12.2026"
                  autoComplete="off"
                  data-testid="editor-expires"
                />
              </label>
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
            </div>

            <div className="vt-ed-fields">
              <div className="vt-ed-fields-head">
                <span className="label-mono">Поля</span>
                <span className="vt-ed-legend label-mono" title="Поле с включённым ct шифруется AES-GCM">
                  <IconLock /> ct — поле шифруется
                </span>
                <span className="grow" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setFields((all) => [...all, { name: 'Своё поле', kind: 'text', value: '', secret: false }])
                  }
                  data-testid="editor-add-field"
                >
                  <IconPlus />
                  Поле
                </button>
              </div>

              {fields.map((f, i) => (
                <div className={`vt-fe${f.secret ? ' is-ct' : ''}${f.kind === 'multiline' ? ' is-multi' : ''}`} key={f.id ?? `new-${i}`}>
                  <div className="vt-fe-top">
                    <input
                      className="input vt-fe-name"
                      value={f.name}
                      onChange={(e) => patch(i, { name: e.target.value })}
                      aria-label="Имя поля"
                      placeholder="Поле"
                      data-testid={`editor-field-name-${i}`}
                    />
                    <VtSelect
                      className="vt-fe-kind"
                      value={f.kind}
                      onChange={(v) => {
                        const kind = v as FieldKind
                        patch(i, { kind, secret: kind === 'password' || kind === 'secret' ? true : f.secret })
                      }}
                      ariaLabel="Тип поля"
                      testId={`editor-field-kind-${i}`}
                      options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
                    />
                    {f.kind !== 'multiline' && (
                      <input
                        className="input vt-fe-value"
                        type={f.secret ? 'password' : 'text'}
                        placeholder={f.kind === 'date' ? 'дд.мм.гггг' : 'Значение'}
                        value={f.value}
                        onChange={(e) => patch(i, { value: e.target.value })}
                        autoComplete="off"
                        aria-label={f.name}
                        data-testid={`editor-field-value-${i}`}
                      />
                    )}
                    <button
                      className={`vt-ct${f.secret ? ' on' : ''}`}
                      title={f.secret ? 'Шифруется AES-GCM · нажмите, чтобы сделать открытым' : 'Открытое поле · нажмите, чтобы шифровать'}
                      aria-pressed={f.secret}
                      onClick={() => patch(i, { secret: !f.secret })}
                      data-testid={`editor-field-secret-${i}`}
                    >
                      <IconLock />
                      <span>ct</span>
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
                  </div>
                  {f.kind === 'multiline' && (
                    <textarea
                      className="input vt-fe-value"
                      rows={2}
                      placeholder="Значение"
                      value={f.value}
                      onChange={(e) => patch(i, { value: e.target.value })}
                      aria-label={f.name}
                      data-testid={`editor-field-value-${i}`}
                    />
                  )}
                  {f.secret && f.value && (
                    <span className={`vt-mini-strength s${strengthOf(f.value).score}`}>
                      {strengthOf(f.value).label} · <b className="num">{strengthOf(f.value).bits}</b> бит
                    </span>
                  )}
                </div>
              ))}
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

            {error && (
              <p className="vt-error" role="alert" data-testid="editor-error">
                {error}
              </p>
            )}
          </div>
        )}

        <footer className="vt-modal-foot">
          <span className="vt-note">
            Секретные поля (ct) шифруются AES-GCM ключом записи, выведенным из ключа сейфа.
          </span>
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
