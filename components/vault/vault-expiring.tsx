'use client'

/* ============================================================
   ИСТЕКАЮЩИЕ · записи со сроком: просроченные и близкие к сроку
   Сортировка по дате, бейджи EXPIRED / 1 / 7 / 30 дней.
   Никакой расшифровки: работаем только с метаданными записи.
   ============================================================ */

import { IconCheck, IconChevronDown, IconClock, iconOf } from '@/components/icons'
import { TYPE_HUE, TYPE_META, expiryStage, type SecretRecord } from '@/lib/secrets'

export function VaultExpiring({
  entries,
  now,
  onOpen,
}: {
  entries: SecretRecord[]
  now: number
  onOpen: (id: string) => void
}) {
  const rows = entries
    .filter((e) => e.expiredAfter !== null)
    .map((e) => ({
      e,
      days: Math.ceil((e.expiredAfter! - now) / 86_400_000),
      stage: expiryStage(e, now)!,
    }))
    .sort((a, b) => a.e.expiredAfter! - b.e.expiredAfter!)

  const expired = rows.filter((r) => r.stage === 'expired')
  const soon = rows.filter((r) => r.stage === 'd1' || r.stage === 'd7' || r.stage === 'd30')
  const later = rows.filter((r) => r.stage === 'later')

  return (
    <div className="vt-exp" data-testid="vault-expiring">
      <div className="vt-exp-summary panel">
        <div className={`vt-exp-score s${expired.length ? 0 : soon.length ? 2 : 4}`}>
          <b className="num" data-testid="expiring-count">
            {expired.length + soon.length}
          </b>
          <span className="label-mono">требуют внимания</span>
        </div>
        <div className="vt-exp-stats">
          <span className={expired.length ? 'bad' : ''}>
            <b className="num">{expired.length}</b> просрочено
          </span>
          <span className={soon.length ? 'warn' : ''}>
            <b className="num">{soon.length}</b> в ближайшие 30 дн
          </span>
          <span>
            <b className="num">{later.length}</b> позже
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="vt-health-ok panel" data-testid="expiring-empty">
          <IconCheck />
          <p>
            Ни у одной записи не задан срок. Поставьте дату в поле «Истекает» редактора — сюда
            попадут карты, лицензии и API-ключи, которые скоро придётся обновить.
          </p>
        </div>
      ) : (
        <>
          <Group id="expired" title="Просрочено" note="срок уже прошёл — значение пора менять" rows={expired} onOpen={onOpen} />
          <Group id="soon" title="Скоро истекут" note="до срока 30 дней и меньше" rows={soon} onOpen={onOpen} />
          <Group id="later" title="С запасом" note="срок дальше 30 дней" rows={later} onOpen={onOpen} />
        </>
      )}
      <p className="vt-note">
        Напоминания приходят в ленту уведомлений за 30, 7 и 1 день до срока и в день истечения.
        Вид считается локально по метаданным: секретные поля не расшифровываются.
      </p>
    </div>
  )
}

function Group({
  id,
  title,
  note,
  rows,
  onOpen,
}: {
  id: string
  title: string
  note: string
  rows: { e: SecretRecord; days: number; stage: string }[]
  onOpen: (id: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <section className="vt-health-group" data-testid={`expiring-${id}`}>
      <header className="vt-health-group-head">
        <span className="label-mono">
          {title} · <b className="num">{rows.length}</b>
        </span>
        <span className="vt-health-note">{note}</span>
      </header>
      {rows.map(({ e, days, stage }) => {
        const Icon = iconOf(TYPE_META[e.type].icon)
        return (
          <button
            key={e.id}
            className="vt-health-row"
            onClick={() => onOpen(e.id)}
            data-testid={`expiring-row-${e.id}`}
          >
            <span className="vt-health-ico" style={{ color: `hsl(${TYPE_HUE[e.type]} 32% 70%)` }}>
              <Icon />
            </span>
            <span className="vt-health-title ellipsis">{e.title}</span>
            <span className="vt-health-field label-mono">{TYPE_META[e.type].label}</span>
            <span className="vt-health-meta label-mono">
              <IconClock />
              {new Date(e.expiredAfter!).toLocaleDateString('ru-RU')}
            </span>
            <span
              className={`vt-exp-badge b-${stage}`}
              data-testid={`expiring-badge-${e.id}`}
            >
              {stage === 'expired' ? 'EXPIRED' : `${Math.max(days, 0)} дн`}
            </span>
            <IconChevronDown className="vt-health-go" />
          </button>
        )
      })}
    </section>
  )
}
