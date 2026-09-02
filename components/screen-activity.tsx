'use client'

/* ============================================================
   ЦЕНТР АКТИВНОСТИ (NF-3)
   Единое место, где видно всё, что сейф делает прямо сейчас, и что уже
   произошло. Две части:
     1. «Сейчас» — живые плитки текущего состояния: индексация с прогрессом,
        движок ИИ, исходящий трафик и замок. Только этот блок подписан на
        частый прогресс индексатора, поэтому лента ниже не дёргается.
     2. «Лента истории» — журнал безопасности (LG-3) и уведомления в одном
        потоке с фильтрами (тип, период, объект), переходом к источнику и
        выгрузкой. Уведомления остаются оповещениями: клик ведёт к факту.
   Журнал по-прежнему живёт отдельной панелью в настройках — здесь он
   агрегируется, а не переезжает.
   ============================================================ */

import '@/app/styles/screen-activity.css'
import { useCallback, useEffect, useMemo, useState, type ComponentType, type SVGProps } from 'react'
import { download } from '@/lib/secrets-io'
import {
  isSevereKind,
  journalKindLabel,
  readJournal,
  subscribeJournal,
  type JournalEntry,
  type JournalKind,
} from '@/lib/journal'
import {
  useLockStore,
  useNavStore,
  useNotifsStore,
  useToast,
  type Notif,
  type NotifCat,
} from '@/lib/vault-store'
import { useEngineStore } from '@/lib/store/engine'
import { useIndexProgress, useIndexSummary } from '@/lib/indexer/context'
import {
  IconArrowRight,
  IconChipAi,
  IconDatabase,
  IconKey,
  IconLockRound,
  IconPipeline,
  IconRefresh,
  IconShield,
  IconTrash,
  iconOf,
  type IconId,
} from './icons'
import { Dropdown } from './dropdown'

/* ---------- единый вид события ленты ---------- */

type Tone = 'ok' | 'warn' | 'danger' | 'info'
type ObjType = 'file' | 'note' | 'secret' | 'setting' | 'screen' | 'journal' | 'none'
type CatKey = 'journal' | 'privacy' | 'pipeline' | 'system'

type FeedItem = {
  id: string
  source: 'journal' | 'notif'
  at: number
  tone: Tone
  icon: IconId
  catKey: CatKey
  category: string
  title: string
  detail: string
  severe: boolean
  obj: ObjType
  open: () => void
}

const CAT_ORDER: CatKey[] = ['journal', 'privacy', 'pipeline', 'system']
const CAT_LABELS: Record<CatKey, string> = {
  journal: 'Журнал',
  privacy: 'Приватность',
  pipeline: 'Конвейер',
  system: 'Система',
}

const NOTIF_CAT_KEY: Record<NotifCat, CatKey> = {
  pipeline: 'pipeline',
  privacy: 'privacy',
  system: 'system',
}

const JKIND_ICON: Record<JournalKind, IconId> = {
  'lock-setup': 'lockRound',
  'master-changed': 'key',
  'lock-disabled': 'shield',
  'lock-reset': 'trash',
  'key-declined': 'shield',
  'plaintext-export': 'database',
  'backup-restore': 'database',
  'vault-wipe': 'trash',
  'ai-saved-password': 'key',
  'cloud-consent': 'chipAi',
  'cloud-request': 'chipAi',
}

const OBJ_LABELS: Record<ObjType, string> = {
  file: 'Файлы',
  note: 'Стикеры',
  secret: 'Секреты',
  setting: 'Настройки',
  screen: 'Экраны',
  journal: 'Записи журнала',
  none: 'Без ссылки',
}

const DAY = 86_400_000

function stamp(at: number, now: number): string {
  const d = Math.max(0, now - at)
  if (d < 60_000) return 'только что'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} мин назад`
  if (d < DAY) return `${Math.floor(d / 3_600_000)} ч назад`
  return new Date(at).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/* ============================================================
   ЖИВАЯ ПОЛОСА «СЕЙЧАС»
   Отдельный компонент: только он подписан на частый прогресс индексатора,
   поэтому лента истории не перерисовывается на каждый обработанный файл.
   ============================================================ */

const PHASE_LABEL: Record<string, string> = {
  scan: 'Обход папки',
  index: 'Чтение и разбор',
  done: 'Индекс готов',
  cancelled: 'Отменена',
  error: 'Прервана',
}

type TileState = 'live' | 'ok' | 'warn' | 'off' | 'idle'
type Tile = {
  key: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  value: string
  sub?: string
  state: TileState
  pct?: number
}

function LiveNow() {
  const { progress: p } = useIndexProgress()
  const s = useIndexSummary()
  const engine = useEngineStore()
  const { lock } = useLockStore()
  const view = engine.engineView

  const tiles: Tile[] = []

  /* Индексация */
  const idxPct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
  if (s.busy) {
    tiles.push({
      key: 'index',
      Icon: IconRefresh,
      label: 'Индексация',
      value: PHASE_LABEL[p.phase] ?? 'Идёт',
      sub: `${p.done}${p.total > 0 ? ` из ${p.total}` : ''} файлов${p.current ? ` · ${p.current}` : ''}`,
      state: 'live',
      pct: p.phase === 'scan' ? 4 : idxPct,
    })
  } else if (s.needPermission) {
    tiles.push({
      key: 'index',
      Icon: IconShield,
      label: 'Индексация',
      value: 'Нужен доступ к папке',
      sub: s.folder ? `Папка «${s.folder}» ждёт подтверждения` : 'Подтвердите доступ в библиотеке',
      state: 'warn',
    })
  } else if (s.indexedCount > 0) {
    tiles.push({
      key: 'index',
      Icon: IconPipeline,
      label: 'Индексация',
      value: `${s.indexedCount} файлов в индексе`,
      sub: s.folder ? `Источник · ${s.folder}` : 'Поиск ищет по содержимому',
      state: 'ok',
    })
  } else {
    tiles.push({
      key: 'index',
      Icon: IconPipeline,
      label: 'Индексация',
      value: 'Не запущена',
      sub: 'Подключите папку — файлы прочитаются локально',
      state: 'idle',
    })
  }

  /* Движок ИИ */
  if (engine.checking) {
    tiles.push({
      key: 'engine',
      Icon: IconChipAi,
      label: 'Движок ИИ',
      value: 'Проверяем движок…',
      sub: view.model,
      state: 'live',
    })
  } else if (view.isCloud) {
    tiles.push({
      key: 'engine',
      Icon: IconChipAi,
      label: 'Движок ИИ',
      value: view.label,
      sub: view.model,
      state: 'warn',
    })
  } else if (engine.local?.ok) {
    tiles.push({
      key: 'engine',
      Icon: IconChipAi,
      label: 'Движок ИИ',
      value: 'Локальный движок',
      sub: `${view.model} · на устройстве`,
      state: 'ok',
    })
  } else {
    tiles.push({
      key: 'engine',
      Icon: IconChipAi,
      label: 'Движок ИИ',
      value: 'Движок не подключён',
      sub: engine.error ? 'Статус недоступен' : `${view.model} · запустите Ollama`,
      state: 'off',
    })
  }

  /* Исходящий трафик */
  tiles.push(
    view.isCloud
      ? {
          key: 'traffic',
          Icon: IconShield,
          label: 'Исходящий трафик',
          value: 'Возможны внешние запросы',
          sub: view.netLabel,
          state: 'warn',
        }
      : {
          key: 'traffic',
          Icon: IconShield,
          label: 'Исходящий трафик',
          value: 'Нет исходящих запросов',
          sub: 'Всё считается на устройстве',
          state: 'ok',
        },
  )

  /* Замок */
  tiles.push(
    lock.status === 'unlocked'
      ? { key: 'lock', Icon: IconLockRound, label: 'Замок сейфа', value: 'Сейф открыт', sub: 'PBKDF2 · AES-GCM', state: 'ok' }
      : lock.status === 'locked'
        ? { key: 'lock', Icon: IconLockRound, label: 'Замок сейфа', value: 'Сейф закрыт', sub: 'Нужен мастер-ключ', state: 'warn' }
        : { key: 'lock', Icon: IconLockRound, label: 'Замок сейфа', value: 'Замок выключен', sub: 'Содержимое без защиты', state: 'idle' },
  )

  const liveCount = tiles.filter((t) => t.state === 'live').length

  return (
    <section className="act-now panel" data-testid="activity-now">
      <div className="act-now-head">
        <span className="act-now-title">
          <IconPipeline width={15} height={15} />
          Сейчас
        </span>
        <span className={`act-live-pill${liveCount > 0 ? ' on' : ''}`} data-testid="activity-live-pill">
          <i className="act-pulse" />
          {liveCount > 0
            ? `${liveCount} ${liveCount === 1 ? 'процесс идёт' : 'процесса идёт'}`
            : 'Фоновых процессов нет'}
        </span>
      </div>
      <div className="act-tiles">
        {tiles.map((t) => (
          <div
            key={t.key}
            className="act-tile"
            data-state={t.state}
            data-testid={`activity-tile-${t.key}`}
          >
            <span className="act-tile-ico">
              <t.Icon width={16} height={16} />
            </span>
            <div className="act-tile-body">
              <span className="act-tile-label label-mono">{t.label}</span>
              <b className="act-tile-value">{t.value}</b>
              {t.sub && <span className="act-tile-sub">{t.sub}</span>}
              {t.pct != null && (
                <div className="act-mini-bar">
                  <i style={{ width: `${t.pct}%` }} />
                </div>
              )}
            </div>
            <i className="act-dot" />
          </div>
        ))}
      </div>
    </section>
  )
}

/* ============================================================
   ЭКРАН
   ============================================================ */

type TypeFilter = 'all' | 'severe' | CatKey
type Period = 'today' | '7d' | 'all'

export function ScreenActivity() {
  const { notifs } = useNotifsStore()
  const { openNotif, openSetting } = useNavStore()
  const { flash } = useToast()

  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [period, setPeriod] = useState<Period>('all')
  const [obj, setObj] = useState<ObjType | 'all'>('all')
  const [now, setNow] = useState(() => Date.now())

  const reload = useCallback(() => {
    void readJournal().then(setJournal)
  }, [])

  useEffect(() => {
    reload()
    return subscribeJournal(reload)
  }, [reload])

  /* Относительные метки времени освежаем раз в 30 с — не каждую секунду. */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  /* Единый поток: журнал + активные уведомления, свежее сверху. */
  const items = useMemo<FeedItem[]>(() => {
    const fromJournal: FeedItem[] = journal.map((e) => {
      const severe = isSevereKind(e.kind)
      return {
        id: `j:${e.id}`,
        source: 'journal',
        at: e.at,
        tone: severe ? 'danger' : e.kind === 'cloud-request' || e.kind === 'cloud-consent' ? 'warn' : 'info',
        icon: JKIND_ICON[e.kind] ?? 'shield',
        catKey: 'journal',
        category: journalKindLabel(e.kind),
        title: e.title,
        detail: e.detail,
        severe,
        obj: 'journal',
        open: () => openSetting(`journal:${e.id}`),
      }
    })

    const fromNotifs: FeedItem[] = notifs
      .filter((n) => !n.archived)
      .map((n: Notif) => ({
        id: `n:${n.id}`,
        source: 'notif',
        at: n.at,
        tone: n.kind,
        icon: n.icon,
        catKey: NOTIF_CAT_KEY[n.cat],
        category: CAT_LABELS[NOTIF_CAT_KEY[n.cat]],
        title: n.title,
        detail: n.body,
        severe: n.kind === 'danger',
        obj: (n.link?.kind as ObjType) ?? 'none',
        open: () => openNotif(n.id),
      }))

    return [...fromJournal, ...fromNotifs].sort((a, b) => b.at - a.at)
  }, [journal, notifs, openNotif, openSetting])

  const severeCount = useMemo(() => items.filter((i) => i.severe).length, [items])

  const presentCats = useMemo(() => {
    const seen = new Set(items.map((i) => i.catKey))
    return CAT_ORDER.filter((c) => seen.has(c))
  }, [items])

  const presentObjs = useMemo(() => {
    const seen = new Set(items.map((i) => i.obj))
    return (Object.keys(OBJ_LABELS) as ObjType[]).filter((o) => seen.has(o))
  }, [items])

  const shown = useMemo(() => {
    const cutoff = period === 'today' ? now - DAY : period === '7d' ? now - 7 * DAY : 0
    return items.filter((i) => {
      if (i.at < cutoff) return false
      if (obj !== 'all' && i.obj !== obj) return false
      if (typeFilter === 'all') return true
      if (typeFilter === 'severe') return i.severe
      return i.catKey === typeFilter
    })
  }, [items, typeFilter, period, obj, now])

  function exportFeed() {
    const at = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const payload = {
      kind: 'workflow-activity',
      version: 1,
      exportedAt: Date.now(),
      count: shown.length,
      items: shown.map((i) => ({
        at: i.at,
        iso: new Date(i.at).toISOString(),
        source: i.source,
        category: i.category,
        title: i.title,
        detail: i.detail,
        severe: i.severe,
        object: i.obj,
      })),
    }
    download(`workflow-activity-${at}.json`, JSON.stringify(payload, null, 2), 'application/json')
    flash(`Лента выгружена: ${shown.length} событий. Записи журнала остались в базе.`)
  }

  return (
    <div className="act-page" data-testid="screen-activity">
      <div className="act-shell">
        <header className="act-head">
          <div className="act-head-text">
            <h1 className="act-title">Центр активности</h1>
            <p className="act-sub">
              Всё, что сейф делает прямо сейчас, и вся история событий — журнал безопасности и
              уведомления в одном потоке.
            </p>
          </div>
        </header>

        <LiveNow />

        <section className="act-feed panel" data-testid="activity-feed">
          <div className="act-feed-head">
            <div className="sec-head-text">
              <div className="setting-title">Лента истории</div>
              <div className="setting-note">
                Уведомления остаются оповещениями и ведут к источнику. Журнал безопасности виден
                здесь и по-прежнему живёт своей панелью в настройках.
              </div>
            </div>
            <span className="sec-meta label-mono" data-testid="activity-count">
              {shown.length} из {items.length}
            </span>
          </div>

          <div className="act-bar">
            <div className="act-chips" role="group" aria-label="Фильтр ленты по типу">
              <button
                className="act-chip"
                aria-pressed={typeFilter === 'all'}
                onClick={() => setTypeFilter('all')}
                data-testid="activity-filter-all"
              >
                Все
              </button>
              {severeCount > 0 && (
                <button
                  className="act-chip severe"
                  aria-pressed={typeFilter === 'severe'}
                  onClick={() => setTypeFilter('severe')}
                  data-testid="activity-filter-severe"
                >
                  Тревожное · {severeCount}
                </button>
              )}
              {presentCats.map((c) => (
                <button
                  key={c}
                  className="act-chip"
                  aria-pressed={typeFilter === c}
                  onClick={() => setTypeFilter(c)}
                  data-testid={`activity-filter-${c}`}
                >
                  {CAT_LABELS[c]}
                </button>
              ))}
            </div>

            <Dropdown
              label="Период"
              variant="chip"
              value={period}
              options={[
                { value: 'all', label: 'За всё время' },
                { value: 'today', label: 'Сегодня' },
                { value: '7d', label: 'За 7 дней' },
              ]}
              onChange={(val) => setPeriod(val as Period)}
              menuWidth={200}
              className="act-dd"
              testId="activity-period"
            />

            <Dropdown
              label="Объект"
              variant="chip"
              value={obj}
              options={[
                { value: 'all', label: 'Любой объект' },
                ...presentObjs.map((o) => ({ value: o, label: OBJ_LABELS[o] })),
              ]}
              onChange={(val) => setObj(val as ObjType | 'all')}
              menuWidth={220}
              className="act-dd"
              testId="activity-object"
            />

            <button
              className="btn"
              onClick={exportFeed}
              disabled={shown.length === 0}
              data-testid="activity-export"
            >
              Выгрузить ленту
            </button>
          </div>

          <div className="act-rows" data-testid="activity-rows">
            {shown.length === 0 ? (
              <p className="act-empty" data-testid="activity-empty">
                {items.length === 0
                  ? 'Пока ничего не происходило — лента пуста.'
                  : 'Под текущие фильтры ничего не подходит.'}
              </p>
            ) : (
              shown.map((i) => {
                const Icon = iconOf(i.icon)
                return (
                  <button
                    key={i.id}
                    className="act-row"
                    data-tone={i.tone}
                    data-source={i.source}
                    onClick={i.open}
                    data-testid="activity-row"
                  >
                    <span className="act-row-ico">
                      <Icon />
                    </span>
                    <span className="act-row-main">
                      <span className="act-row-top">
                        <b className="act-row-title">{i.title}</b>
                        {i.severe && (
                          <i className="act-flag" data-testid="activity-severe-flag">
                            необратимо
                          </i>
                        )}
                      </span>
                      <span className="act-row-detail">{i.detail}</span>
                      <span className="act-row-meta label-mono">
                        <span className="act-badge" data-src={i.source}>
                          {i.source === 'journal' ? 'Журнал' : i.category}
                        </span>
                        <span className="act-row-time">{stamp(i.at, now)}</span>
                      </span>
                    </span>
                    <IconArrowRight className="act-row-go" />
                  </button>
                )
              })
            )}
          </div>

          <p className="act-note">
            <IconShield width={13} height={13} /> Клик по событию открывает его источник. Записи
            журнала безопасности не удаляются и не чистятся — очистка ленты уведомлений их не
            затрагивает.
          </p>
        </section>
      </div>
    </div>
  )
}
