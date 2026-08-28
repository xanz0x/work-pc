'use client'

/* ============================================================
   PASSWORD HEALTH · локальный аудит паролей
   Слабые, повторно использованные, старые (180+ дней) — с переходом
   к записи. Расшифровка только в памяти, наружу не уходит ничего,
   открытые значения нигде не рендерятся.
   ============================================================ */

import { useEffect, useState } from 'react'
import { IconCheck, IconChevronDown, iconOf } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import { TYPE_HUE, TYPE_META, type SecretType } from '@/lib/secrets'
import { scorePassword } from '@/lib/secrets-gen'

const OLD_DAYS = 180

type Row = {
  id: string
  title: string
  type: SecretType
  fieldName: string
  score: number
  bits: number
  label: string
  reuse: number
  ageDays: number
}

export function VaultHealth({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useSecrets()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const tmp: { row: Omit<Row, 'reuse'>; plain: string }[] = []
      const nowTs = Date.now()
      for (const e of s.live) {
        for (const f of e.fields) {
          if (!f.secret || f.kind !== 'password' || !f.value) continue
          const plain = await s.openCipher(e.id, f.value)
          if (!plain) continue
          const st = scorePassword(plain)
          const lastChange = Math.max(
            e.createdAt,
            ...e.history.filter((h) => h.fieldId === f.id).map((h) => h.at),
          )
          tmp.push({
            plain,
            row: {
              id: e.id,
              title: e.title,
              type: e.type,
              fieldName: f.name,
              score: st.score,
              bits: st.bits,
              label: st.label,
              ageDays: Math.floor((nowTs - lastChange) / 86_400_000),
            },
          })
        }
      }
      const counts = new Map<string, number>()
      for (const t of tmp) counts.set(t.plain, (counts.get(t.plain) ?? 0) + 1)
      const out = tmp.map((t) => ({ ...t.row, reuse: counts.get(t.plain)! }))
      if (alive) setRows(out) /* открытые значения дальше этой строки не живут */
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.live, s.ready])

  if (rows === null)
    return (
      <div className="vt-health" data-testid="vault-health">
        <p className="vt-note">Расшифровываю пароли в памяти и считаю оценку…</p>
      </div>
    )

  const weak = rows.filter((r) => r.score <= 1)
  const reused = rows.filter((r) => r.reuse >= 2)
  const old = rows.filter((r) => r.ageDays >= OLD_DAYS)
  const issueKeys = new Set([...weak, ...reused, ...old].map((r) => r.id + '·' + r.fieldName))
  const health = rows.length === 0 ? 100 : Math.round(100 * (1 - issueKeys.size / rows.length))

  return (
    <div className="vt-health" data-testid="vault-health">
      <div className="vt-health-summary panel">
        <div className={`vt-health-score s${health >= 80 ? 4 : health >= 50 ? 2 : 0}`}>
          <b className="num" data-testid="health-score">
            {health}
          </b>
          <span className="label-mono">здоровье</span>
        </div>
        <div className="vt-health-stats">
          <span>
            <b className="num">{rows.length}</b> паролей
          </span>
          <span className={weak.length ? 'bad' : ''}>
            <b className="num">{weak.length}</b> слабых
          </span>
          <span className={reused.length ? 'bad' : ''}>
            <b className="num">{reused.length}</b> повторных
          </span>
          <span className={old.length ? 'bad' : ''}>
            <b className="num">{old.length}</b> старых · {OLD_DAYS}+ дн
          </span>
        </div>
      </div>

      {issueKeys.size === 0 ? (
        <div className="vt-health-ok panel" data-testid="health-all-ok">
          <IconCheck />
          <p>
            {rows.length === 0
              ? 'Пока нет ни одного секретного поля-пароля — аудитировать нечего.'
              : 'Все пароли крепкие, уникальные и свежие. Так держать.'}
          </p>
        </div>
      ) : (
        <>
          <HealthGroup
            id="weak"
            title="Слабые"
            note="меньше 50 бит энтропии — подбираются быстро"
            rows={weak}
            meta={(r) => `${r.label} · ${r.bits} бит`}
            onOpen={onOpen}
          />
          <HealthGroup
            id="reused"
            title="Повторно использованные"
            note="один пароль в нескольких местах — одна утечка кладёт всё"
            rows={reused}
            meta={(r) => `используется в ${r.reuse} записях`}
            onOpen={onOpen}
          />
          <HealthGroup
            id="old"
            title="Старые"
            note={`не менялись дольше ${OLD_DAYS} дней`}
            rows={old}
            meta={(r) => `${r.ageDays} дн без смены`}
            onOpen={onOpen}
          />
        </>
      )}
      <p className="vt-note">
        Аудит считается локально при каждом открытии вида. Открытые значения живут только в
        памяти на время расчёта и нигде не показываются.
      </p>
    </div>
  )
}

function HealthGroup({
  id,
  title,
  note,
  rows,
  meta,
  onOpen,
}: {
  id: string
  title: string
  note: string
  rows: Row[]
  meta: (r: Row) => string
  onOpen: (id: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <section className="vt-health-group" data-testid={`health-${id}`}>
      <header className="vt-health-group-head">
        <span className="label-mono">
          {title} · <b className="num">{rows.length}</b>
        </span>
        <span className="vt-health-note">{note}</span>
      </header>
      {rows.map((r) => {
        const Icon = iconOf(TYPE_META[r.type].icon)
        return (
          <button
            key={`${r.id}-${r.fieldName}`}
            className="vt-health-row"
            onClick={() => onOpen(r.id)}
            data-testid={`health-row-${r.id}`}
          >
            <span className="vt-health-ico" style={{ color: `hsl(${TYPE_HUE[r.type]} 32% 70%)` }}>
              <Icon />
            </span>
            <span className="vt-health-title ellipsis">{r.title}</span>
            <span className="vt-health-field label-mono">{r.fieldName}</span>
            <span className="vt-health-meta label-mono">{meta(r)}</span>
            <IconChevronDown className="vt-health-go" />
          </button>
        )
      })}
    </section>
  )
}
