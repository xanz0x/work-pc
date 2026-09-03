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
import { fmtBytes } from '@/lib/data'

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
const HOUR = 3_600_000

/** Склонение «ход / хода / ходов». */
function hodWord(n: number): string {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return 'ход'
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'хода'
  return 'ходов'
}

/** Начало сегодняшнего дня по местному времени. */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

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
  valueTestId?: string
}

function LiveNow() {
  const { progress: p } = useIndexProgress()
  const s = useIndexSummary()
  const engine = useEngineStore()
  const { lock } = useLockStore()
  const view = engine.engineView

  /* Живой счётчик: сколько облачных ходов ушло наружу за сегодня — прямо из
     журнала (append-only), поэтому число честное и переживает перезагрузку. */
  const [cloudToday, setCloudToday] = useState(0)
  useEffect(() => {
    const load = () => {
      void readJournal().then((rows) => {
        const from = startOfToday()
        setCloudToday(rows.filter((r) => r.kind === 'cloud-request' && r.at >= from).length)
      })
    }
    load()
    return subscribeJournal(load)
  }, [])

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
  tiles.push({
    key: 'traffic',
    Icon: IconShield,
    label: 'Исходящий трафик',
    value:
      cloudToday > 0
        ? `${cloudToday} ${hodWord(cloudToday)} за сегодня`
        : view.isCloud
          ? 'Ноль ходов за сегодня'
          : 'Нет исходящих запросов',
    sub: view.isCloud
      ? 'Режим допускает внешние запросы'
      : cloudToday > 0
        ? 'Режим сейчас локальный'
        : 'Всё считается на устройстве',
    state: view.isCloud || cloudToday > 0 ? 'warn' : 'ok',
    valueTestId: 'activity-cloud-today',
  })

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
              <b className="act-tile-value" data-testid={t.valueTestId}>{t.value}</b>
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
   МЕТРИКИ СИСТЕМЫ · собственные SVG-графики (zero-dependency)
   Честно к local-first: показываем то, что реально измеримо в браузере —
   нагрузку памяти вкладки (живой график JS-кучи), занятость локального
   хранилища и, главное для этого продукта, исходящий облачный трафик и
   общую активность сейфа за сутки. Никаких выдуманных серверных метрик.
   ============================================================ */

/** Разложить события по часовым корзинам за последние `hours` часов. */
function hourlyBuckets(times: number[], now: number, hours = 24): number[] {
  const buckets = new Array(hours).fill(0)
  const start = now - hours * HOUR
  for (const t of times) {
    if (t < start) continue
    const idx = Math.min(hours - 1, Math.floor((t - start) / HOUR))
    buckets[idx] += 1
  }
  return buckets
}

const CHART_W = 220
const CHART_H = 46

/* История нагрузки памяти живёт между сессиями: коарс-семплы JS-кучи в
   localStorage (не чувствительны — только размеры), окно 6 часов. Так всплески
   индексации и облачных ходов видны за часы, а не только в текущей сессии. */
const HEAP_KEY = 'wf.metrics.heap.v1'
const HEAP_WINDOW = 6 * HOUR
const HEAP_CAP = 500
const HEAP_SAMPLE_MS = 30_000

type HeapSample = { t: number; u: number }

function loadHeap(): HeapSample[] {
  try {
    const raw = localStorage.getItem(HEAP_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const cut = Date.now() - HEAP_WINDOW
    return arr
      .filter(
        (x): x is HeapSample =>
          !!x && typeof (x as HeapSample).t === 'number' && typeof (x as HeapSample).u === 'number',
      )
      .filter((x) => x.t >= cut)
      .slice(-HEAP_CAP)
  } catch {
    return []
  }
}

function saveHeap(list: HeapSample[]): void {
  try {
    localStorage.setItem(HEAP_KEY, JSON.stringify(list))
  } catch {
    /* приватный режим или переполнение — история просто не сохранится */
  }
}

/** Живой график-заливка: нагрузка памяти во времени. */
function AreaSpark({ data, tone }: { data: number[]; tone: 'accent' | 'warn' | 'ok' }) {
  if (data.length < 2) {
    return (
      <svg className={`act-spark tone-${tone}`} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="act-spark-flat" x1={0} y1={CHART_H - 2} x2={CHART_W} y2={CHART_H - 2} />
      </svg>
    )
  }
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = Math.max(1, max - min)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * CHART_W
    const y = CHART_H - 3 - ((v - min) / range) * (CHART_H - 6)
    return `${x.toFixed(1)} ${y.toFixed(1)}`
  })
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p).join(' ')
  const area = `${line} L ${CHART_W} ${CHART_H} L 0 ${CHART_H} Z`
  return (
    <svg className={`act-spark tone-${tone}`} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="act-spark-area" d={area} />
      <path className="act-spark-line" d={line} />
    </svg>
  )
}

/** Столбики по часам: облачные ходы / события за сутки. */
function BarSpark({ data, tone }: { data: number[]; tone: 'accent' | 'warn' | 'ok' }) {
  const max = Math.max(1, ...data)
  const n = data.length
  const gap = 1.6
  const bw = (CHART_W - gap * (n - 1)) / n
  return (
    <svg className={`act-bars tone-${tone}`} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true">
      {data.map((v, i) => {
        const h = v > 0 ? Math.max(2.5, (v / max) * (CHART_H - 4)) : 1
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={CHART_H - h}
            width={bw}
            height={h}
            rx={0.8}
            className={v > 0 ? 'on' : 'off'}
          />
        )
      })}
    </svg>
  )
}

type HeapInfo = { used: number; limit: number } | null

function SystemMetrics({ journal, items }: { journal: JournalEntry[]; items: FeedItem[] }) {
  const [hist, setHist] = useState<HeapSample[]>(() => loadHeap())
  const [heap, setHeap] = useState<HeapInfo>(null)
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  /* Часовые корзины освежаем не спеша — раз в 5 с. */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  /* Замер памяти + запись истории в localStorage (окно 6 ч). */
  useEffect(() => {
    const read = () => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
      if (!mem) return
      setHeap({ used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit })
      setHist((prev) => {
        const t = Date.now()
        const next = [...prev, { t, u: mem.usedJSHeapSize }]
          .filter((sm) => t - sm.t <= HEAP_WINDOW)
          .slice(-HEAP_CAP)
        saveHeap(next)
        return next
      })
    }
    read()
    const t = setInterval(read, HEAP_SAMPLE_MS)
    return () => clearInterval(t)
  }, [])

  const samples = useMemo(() => hist.map((h) => h.u), [hist])

  /* Занятость локального хранилища (origin storage). Раз в 5 с. */
  useEffect(() => {
    let alive = true
    const read = async () => {
      try {
        if (navigator.storage?.estimate) {
          const e = await navigator.storage.estimate()
          if (alive) setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 })
        }
      } catch {
        /* приватный режим — оценка недоступна */
      }
    }
    void read()
    const t = setInterval(() => void read(), 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const cloudBuckets = useMemo(
    () => hourlyBuckets(journal.filter((e) => e.kind === 'cloud-request').map((e) => e.at), now),
    [journal, now],
  )
  const eventBuckets = useMemo(() => hourlyBuckets(items.map((i) => i.at), now), [items, now])

  const cloud24 = cloudBuckets.reduce((a, b) => a + b, 0)
  const events24 = eventBuckets.reduce((a, b) => a + b, 0)
  const storagePct = est && est.quota > 0 ? Math.min(100, Math.round((est.usage / est.quota) * 100)) : 0
  const heapPct = heap && heap.limit > 0 ? Math.min(100, Math.round((heap.used / heap.limit) * 100)) : 0
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined

  return (
    <section className="act-metrics panel" data-testid="activity-metrics">
      <div className="act-now-head">
        <span className="act-now-title">
          <IconDatabase width={15} height={15} />
          Метрики системы
        </span>
        <span className="act-metrics-hint label-mono">только локальные измерения · вживую</span>
      </div>

      <div className="act-metric-grid">
        {/* Нагрузка · память вкладки */}
        <div className="act-metric" data-testid="metric-memory">
          <div className="act-metric-head">
            <span className="act-metric-label label-mono">Нагрузка · память</span>
            {heap ? (
              <>
                <b className="act-metric-value">{fmtBytes(heap.used)}</b>
                <span className="act-metric-sub">
                  {heapPct}% лимита · история 6 ч{cores ? ` · ${cores} ядер` : ''}
                </span>
              </>
            ) : (
              <>
                <b className="act-metric-value">{cores ? `${cores} ядер` : 'н/д'}</b>
                <span className="act-metric-sub">Браузер не отдаёт объём JS-кучи</span>
              </>
            )}
          </div>
          <div className="act-metric-chart">
            <AreaSpark data={samples} tone={heapPct >= 75 ? 'warn' : 'accent'} />
          </div>
        </div>

        {/* Локальное хранилище */}
        <div className="act-metric" data-testid="metric-storage">
          <div className="act-metric-head">
            <span className="act-metric-label label-mono">Хранилище</span>
            <b className="act-metric-value">{est ? fmtBytes(est.usage) : '—'}</b>
            <span className="act-metric-sub">
              {est ? `из ${fmtBytes(est.quota)} · ${storagePct}%` : 'оценка недоступна'}
            </span>
          </div>
          <div className="act-metric-chart center">
            <div className="act-metric-bar" data-hot={storagePct >= 80}>
              <i style={{ width: `${storagePct}%` }} />
            </div>
            <span className="act-metric-bignum num">{storagePct}%</span>
          </div>
        </div>

        {/* Исходящий облачный трафик · 24 ч (флагманская метрика приватности) */}
        <div className="act-metric" data-testid="metric-cloud">
          <div className="act-metric-head">
            <span className="act-metric-label label-mono">Исходящий трафик · 24 ч</span>
            <b className={`act-metric-value${cloud24 > 0 ? ' warn' : ' ok'}`}>{cloud24}</b>
            <span className="act-metric-sub">
              {cloud24 > 0 ? 'облачных ходов за сутки' : 'наружу ничего не ушло'}
            </span>
          </div>
          <div className="act-metric-chart">
            <BarSpark data={cloudBuckets} tone={cloud24 > 0 ? 'warn' : 'ok'} />
          </div>
        </div>

        {/* Активность сейфа · 24 ч */}
        <div className="act-metric" data-testid="metric-events">
          <div className="act-metric-head">
            <span className="act-metric-label label-mono">Активность · 24 ч</span>
            <b className="act-metric-value">{events24}</b>
            <span className="act-metric-sub">событий в ленте за сутки</span>
          </div>
          <div className="act-metric-chart">
            <BarSpark data={eventBuckets} tone="accent" />
          </div>
        </div>
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
    <div className="act-page" role="main" data-testid="screen-activity">
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

        <SystemMetrics journal={journal} items={items} />

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
