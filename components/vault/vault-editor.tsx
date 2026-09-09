'use client'

/* ============================================================
   РЕДАКТОР ЗАПИСИ · draft/save/revert, конструктор полей
   v4 · перенос макета «НОВАЯ ЗАПИСЬ»: сетка типов 6×2 иконкой
   вверх, две строки шапки (название/папка, истекает/теги-чипы),
   блок DETAILS со строками «подпись → значение → действия»,
   блок TOTP и футер с отметкой о шифровании. Палитра, радиусы и
   типографика — наши, «Графит»: акцент только на активном.
   Значения секретных полей приходят расшифрованными только сюда
   и уходят обратно как ct:iv.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
import {
  IconClose,
  IconCopy,
  IconDetails,
  IconExternal,
  IconEye,
  IconEyeOff,
  IconLock,
  IconPlus,
  IconQrScan,
  IconRefresh,
  IconShield,
  IconTrash,
  iconOf,
} from '@/components/icons'
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
import { useDialog } from '@/hooks/use-dialog'
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
  { id: 'multiline', label: 'абзац' },
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
  const [tags, setTags] = useState<string[]>(entry?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [folder, setFolder] = useState<string | null>(entry?.folderId ?? folderId)
  const [favorite, setFavorite] = useState(entry?.favorite ?? false)
  const [expires, setExpires] = useState(
    entry?.expiredAfter ? new Date(entry.expiredAfter).toLocaleDateString('ru-RU') : '',
  )
  const [fields, setFields] = useState<Draft[]>([])
  const [shown, setShown] = useState<Record<number, boolean>>({})
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

  function addTag(raw: string) {
    const list = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    if (list.length === 0) return
    setTags((all) => [...new Set([...all, ...list])].slice(0, 12))
    setTagDraft('')
  }

  async function pasteTotp() {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) setTotp(text.trim())
    } catch {
      setError('Буфер обмена недоступен — вставьте секрет вручную')
    }
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
    const tagList = [...new Set([...tags, ...tagDraft.split(',').map((t) => t.trim().toLowerCase())])]
      .filter(Boolean)
      .slice(0, 12)
    const cleaned = fields
      .filter((f) => f.name.trim())
      .map((f) => ({ ...f, name: f.name.trim().slice(0, 60) }))

    const totpValue = totp.trim()
      ? (parseOtpauth(totp.trim())?.secret ?? totp.trim().toUpperCase())
      : null

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

  const { dialogProps } = useDialog<HTMLDivElement>({
    onClose: () => onClose(),
    label: entry ? 'Изменить запись' : 'Новая запись',
  })

  const TypeIcon = iconOf(TYPE_META[type].icon)

  return (
    <div className="vt-modal-back" role="presentation" onPointerDown={() => onClose()}>
      <div
        className="vt-modal panel vt-editor"
        {...dialogProps}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid="entry-editor"
      >
        <header className="vt-modal-head vt-ed-head">
          <span className="label-mono vt-ed-h">{entry ? 'Изменить запись' : 'Новая запись'}</span>
          <span className="vt-ed-type label-mono">/ {TYPE_META[type].label}</span>
          <span className="grow" />
          <button
            className="vt-icon-btn"
            onClick={() => onClose()}
            aria-label="Закрыть"
            data-testid="editor-close"
          >
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

            <div className="vt-ed-row">
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
            </div>

            <div className="vt-ed-row">
              <label className="vt-field">
                <span className={`label-mono${expiresBad ? ' vt-bad' : ''}`}>
                  Истекает · дд.мм.гггг
                </span>
                <input
                  className={`input mono${expiresBad ? ' vt-input-bad' : ''}`}
                  value={expires}
                  inputMode="numeric"
                  onChange={(e) => setExpires(maskRuDate(e.target.value))}
                  placeholder="дд.мм.гггг"
                  autoComplete="off"
                  data-testid="editor-expires"
                />
              </label>
              <div className="vt-field">
                <span className="label-mono">Теги</span>
                <div className="vt-tag-box">
                  {tags.map((t) => (
                    <span className="vt-tag-chip" key={t}>
                      {t}
                      <button
                        type="button"
                        onClick={() => setTags((all) => all.filter((x) => x !== t))}
                        aria-label={`Убрать тег ${t}`}
                        data-testid={`editor-tag-del-${t}`}
                      >
                        <IconClose />
                      </button>
                    </span>
                  ))}
                  <input
                    className="vt-tag-input"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addTag(tagDraft)
                      }
                      if (e.key === 'Backspace' && !tagDraft) setTags((all) => all.slice(0, -1))
                    }}
                    onBlur={() => addTag(tagDraft)}
                    placeholder="Добавить тег…"
                    aria-label="Добавить тег"
                    autoComplete="off"
                    data-testid="editor-tags"
                  />
                </div>
              </div>
            </div>

            <section className="vt-det">
              <div className="vt-det-head">
                <span className="label-mono">
                  <IconDetails width={12} height={12} aria-hidden="true" focusable="false" />
                  Поля записи
                </span>
                <span className="grow" />
                <span
                  className="vt-ed-legend label-mono"
                  title="Поле с включённым замком шифруется AES-GCM"
                >
                  <IconLock /> замок — шифруется
                </span>
              </div>

              {fields.map((f, i) => {
                const str = f.secret && f.value ? strengthOf(f.value) : null
                return (
                  <div
                    className={`vte-row${f.secret ? ' is-ct' : ''}${f.kind === 'multiline' ? ' is-multi' : ''}`}
                    key={f.id ?? `new-${i}`}
                  >
                    <div className="vte-lbl">
                      <input
                        className="vte-name"
                        value={f.name}
                        onChange={(e) => patch(i, { name: e.target.value })}
                        aria-label="Имя поля"
                        placeholder="Поле"
                        data-testid={`editor-field-name-${i}`}
                      />
                    </div>

                    <div className="vte-val">
                      <div className="vte-well">
                        {f.kind === 'multiline' ? (
                          <textarea
                            rows={2}
                            placeholder="Значение"
                            value={f.value}
                            onChange={(e) => patch(i, { value: e.target.value })}
                            aria-label={f.name}
                            data-testid={`editor-field-value-${i}`}
                          />
                        ) : (
                          <input
                            type={f.secret && !shown[i] ? 'password' : 'text'}
                            placeholder={f.kind === 'date' ? 'дд.мм.гггг' : 'Значение'}
                            value={f.value}
                            onChange={(e) => patch(i, { value: e.target.value })}
                            autoComplete="off"
                            aria-label={f.name}
                            data-testid={`editor-field-value-${i}`}
                          />
                        )}
                        {f.kind === 'url' && !f.secret && (
                          <button
                            className="vte-btn"
                            title="Открыть ссылку в новой вкладке"
                            onClick={() => {
                              const url = f.value.trim()
                              if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener')
                            }}
                            data-testid={`editor-field-open-${i}`}
                          >
                            <IconExternal />
                          </button>
                        )}
                        {f.secret && f.kind !== 'multiline' && (
                          <button
                            className="vte-btn"
                            title={shown[i] ? 'Скрыть значение' : 'Показать значение'}
                            aria-pressed={Boolean(shown[i])}
                            onClick={() => setShown((m) => ({ ...m, [i]: !m[i] }))}
                            data-testid={`editor-field-eye-${i}`}
                          >
                            {shown[i] ? <IconEyeOff /> : <IconEye />}
                          </button>
                        )}
                        {f.kind !== 'multiline' && (
                          <button
                            className="vte-btn"
                            title="Сгенерировать значение"
                            onClick={() => setGenFor(i)}
                            data-testid={`editor-field-gen-${i}`}
                          >
                            <IconRefresh />
                          </button>
                        )}
                        <button
                          className="vte-btn"
                          title="Скопировать значение"
                          onClick={() => void navigator.clipboard?.writeText(f.value).catch(() => {})}
                          data-testid={`editor-field-copy-${i}`}
                        >
                          <IconCopy />
                        </button>
                        <button
                          className={`vte-btn vte-lock${f.secret ? ' on' : ''}`}
                          title={
                            f.secret
                              ? 'Шифруется AES-GCM · нажмите, чтобы сделать открытым'
                              : 'Открытое поле · нажмите, чтобы шифровать'
                          }
                          aria-pressed={f.secret}
                          onClick={() => patch(i, { secret: !f.secret })}
                          data-testid={`editor-field-secret-${i}`}
                        >
                          <IconLock />
                        </button>
                        <button
                          className="vte-btn vte-del"
                          title="Удалить поле"
                          onClick={() => setFields((all) => all.filter((_, k) => k !== i))}
                          data-testid={`editor-field-del-${i}`}
                        >
                          <IconTrash />
                        </button>
                      </div>
                      {str && (
                        <div
                          className={`vte-str s${str.score}`}
                          title={`${str.label} · ${str.bits} бит`}
                          data-testid={`editor-field-strength-${i}`}
                        >
                          <i style={{ width: `${Math.max(str.score, 1) * 25}%` }} />
                        </div>
                      )}
                    </div>

                    <VtSelect
                      className="vte-kind"
                      value={f.kind}
                      onChange={(v) => {
                        const kind = v as FieldKind
                        patch(i, {
                          kind,
                          secret: kind === 'password' || kind === 'secret' ? true : f.secret,
                        })
                      }}
                      ariaLabel="Тип поля"
                      testId={`editor-field-kind-${i}`}
                      options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
                    />
                  </div>
                )
              })}

              <button
                className="vt-add-field"
                onClick={() =>
                  setFields((all) => [
                    ...all,
                    { name: 'Своё поле', kind: 'text', value: '', secret: false },
                  ])
                }
                data-testid="editor-add-field"
              >
                <IconPlus width={12} height={12} aria-hidden="true" focusable="false" />
                Добавить поле
              </button>
            </section>

            {TYPE_META[type].totp && (
              <section className="vt-det">
                <div className="vt-det-head">
                  <span className="label-mono">
                    <IconQrScan width={12} height={12} aria-hidden="true" focusable="false" />
                    Конфигурация TOTP
                  </span>
                  <span className="grow" />
                  <button
                    className="vt-det-act label-mono"
                    onClick={() => void pasteTotp()}
                    title="Вставить otpauth:// или Base32-секрет из буфера"
                    data-testid="editor-totp-paste"
                  >
                    <IconQrScan width={12} height={12} aria-hidden="true" focusable="false" />
                    Вставить
                  </button>
                </div>
                <label className="vt-field">
                  <span className="label-mono">Секретный ключ</span>
                  <input
                    className="input mono"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    placeholder="Base32-секрет или otpauth:// ссылка"
                    autoComplete="off"
                    data-testid="editor-totp"
                  />
                </label>
              </section>
            )}

            {error && (
              <p className="vt-error" role="alert" data-testid="editor-error">
                {error}
              </p>
            )}
          </div>
        )}

        <footer className="vt-modal-foot vt-ed-foot">
          <span className="vt-ed-seal label-mono">
            <IconShield width={12} height={12} aria-hidden="true" focusable="false" />
            Сквозное шифрование в сейфе
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
        <VaultGenerator onUse={(value) => patch(genFor, { value })} onClose={() => setGenFor(null)} />
      )}
    </div>
  )
}
