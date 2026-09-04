'use client'

/* AR-2: слой стилей карты приезжает вместе с чанком экрана. */
import '@/app/styles/screen-map.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown, type DropdownOption } from './dropdown'
import {
  IconArrowRight,
  IconClose,
  IconDoc,
  IconLayers,
  IconMinus,
  IconPlus,
  IconSticker,
  IconTarget,
} from './icons'
import { CLUSTERS, clusterIndex, fmtBytes, kindOf, type ClusterId } from '@/lib/data'
import { neighborsOf, type Graph } from '@/lib/graph'
import {
  useDataStore,
  useLockStore,
  useNavStore,
  useNotifsStore,
  useSettingsStore,
  useToast,
} from '@/lib/vault-store'
import { Beam } from '@/components/ui/beam'

/* ============================================================
   КАРТА ПАМЯТИ
   Раньше канвас рисовал 84 придуманных узла со случайными именами:
   красиво, но это была картинка. Теперь он рисует настоящий граф
   сейфа — те же файлы, что в библиотеке, те же живые стикеры и те
   же связи, которые считает lib/graph.ts. Поэтому «N связей» в
   сайдбаре и толщина линий здесь описывают одно и то же.
   ============================================================ */

const WAVE = '47,190,126'
const BEAT_MS = 2400
const BEAT_FAST_MS = 1000
/* Космос: притухание и виньетка красятся в глубокий синий, а не в графит. */
const BG = '6,9,16'
/* Фон непрозрачного канваса — тот же тон, что у .map-space в CSS. */
const MAP_BG = '#010204'

/* ---------------- Таймлайн проигрывания поиска ----------------
   Один источник истины: и канвас, и лог инспектора читают фазу
   из одного и того же прогресса, поэтому не могут разъехаться. */
export type Phase = 'idle' | 'query' | 'cluster' | 'filter' | 'found' | 'settled'
const TIMELINE: { at: number; phase: Phase }[] = [
  { at: 0, phase: 'query' },
  { at: 200, phase: 'cluster' },
  { at: 500, phase: 'filter' },
  { at: 800, phase: 'found' },
  { at: 2000, phase: 'settled' },
]
const SEARCH_END = 2700
const PHASE_ORDER: Phase[] = ['idle', 'query', 'cluster', 'filter', 'found', 'settled']
/* Пауза между волнами: карта живёт сама, кнопки «проиграть» больше нет. */
const AUTO_GAP = 4200
const IDLE_GUARD = 2200

/** Золотой угол: узлы кластера ложатся ровно и не прыгают между сборками. */
const GOLDEN = 2.399963

type Node = {
  /** id объекта сейфа: файл или стикер. У ядра — пустая строка. */
  id: string
  kind: 'file' | 'note' | 'core'
  cx: number
  cy: number
  lx: number
  ly: number
  vx: number
  vy: number
  x: number
  y: number
  r: number
  hue: string
  /** Индекс кластера на сетке 3×2. У ядра −1. */
  cluster: number
  clusterId: ClusterId | null
  name: string
  meta: string
  weight: number
  locked: boolean
  temp: boolean
  processing: boolean
  glow: number
  deg: number
  hot: number
  core?: boolean
  flash?: number
}
type Edge = {
  a: Node
  b: Node
  w: number
  same: boolean
  bow: number
  spoke?: boolean
  qx?: number
  qy?: number
  glow?: number
  lastHue?: string
}
type Pulse = { e: Edge; t: number; sp: number; hue: string; head: number }
type Packet = { a: Node; b: Node; t: number; sp: number; keep: boolean; fade: number }

type NodeInfo = {
  id: string
  kind: 'file' | 'note' | 'core'
  name: string
  meta: string
  links: number
  power: number
  powerLabel: string
  hue: string
  clusterId: ClusterId | null
  cluster: string
  typeLabel: string
  core: boolean
  found?: boolean
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

function phaseAt(t: number): Phase {
  let p: Phase = 'idle'
  for (const s of TIMELINE) if (t >= s.at) p = s.phase
  return p
}

/** Что нужно движку для проигрывания поиска: цель и текст запроса. */
type Seed = { targetId: string | null; query: string; clusterLabel: string; raw: string }

/** Живое описание текущей волны для инспектора и статуса. */
type WaveMeta = { seq: number; query: string; clusterLabel: string; target: string }

export function ScreenMap() {
  /* AR-1: карта — самый дорогой экран, поэтому подписки узкие:
     корпус и граф из домена данных, фокусы и поиск — из навигации. */
  const D = useDataStore()
  const NAV = useNavStore()
  const LK = useLockStore()
  const { graph, stats } = D

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(100)
  const [info, setInfo] = useState<NodeInfo | null>(null)
  const [cluster, setCluster] = useState<ClusterId | 'all'>('all')
  const [phase, setPhase] = useState<Phase>('idle')
  const [cands, setCands] = useState(0)
  const [wave, setWave] = useState<WaveMeta | null>(null)
  const [history, setHistory] = useState<{ name: string; cluster: string; at: number }[]>([])

  /* Движок читает эти ссылки внутри кадра: сам эффект не пересоздаётся,
     иначе анимация перезапускалась бы на каждое изменение сейфа. */
  const graphRef = useRef<Graph>(graph)
  graphRef.current = graph
  const matchedRef = useRef<Set<string>>(NAV.matchedFiles)
  matchedRef.current = NAV.matchedFiles

  /* п.10.4: закрытие замка стирает и локальный фильтр кластера — после разблокировки
     карта начинается с «Всё», а не с того, что выбрал предыдущий пользователь.
     Отклик канваса обеспечивает useEffect([cluster]) ниже: он зовёт api.filter(). */
  const lockEpoch = LK.lockEpoch
  useEffect(() => {
    if (lockEpoch > 0) {
      setCluster('all')
      setInfo(null)
    }
  }, [lockEpoch])

  /** Цель проигрывания: верхний результат живого поиска или самый связный узел. */
  const seed = useMemo<Seed>(() => {
    const hit = NAV.hits.find((h) => h.kind === 'file' || h.kind === 'note')
    const target = hit && graph.byId.has(hit.id) ? graph.byId.get(hit.id)! : null
    const fallback = graph.nodes.length
      ? graph.nodes.reduce((a, b) => (graph.degree[b.idx] > graph.degree[a.idx] ? b : a))
      : null
    const pick = target ?? fallback
    return {
      targetId: pick?.id ?? null,
      query: NAV.query.trim() || (pick ? pick.label : 'связи сейфа'),
      clusterLabel: pick ? CLUSTERS[clusterIndex(pick.cluster)].label : '—',
      raw: NAV.query.trim(),
    }
  }, [NAV.hits, NAV.query, graph])
  const seedRef = useRef<Seed>(seed)
  seedRef.current = seed

  const api = useRef<{
    zoomIn: () => void
    zoomOut: () => void
    reset: () => void
    fit: () => void
    clear: () => void
    wave: (id?: string) => void
    core: () => void
    filter: (ci: number | null) => void
    focusIds: (ids: string[]) => void
    rebuild: () => void
    select: (id: string) => void
  } | null>(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    /* alpha: false — канвас непрозрачный и сам красит фон. Полупрозрачный
       слой браузер смешивал с фоном страницы на каждый кадр; на карте это
       был самый дорогой шаг композиции. */
    const ctx = cv.getContext('2d', { alpha: false })
    if (!ctx) return

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0
    let H = 0
    let dpr = 1
    let nodes: Node[] = []
    let edges: Edge[] = []
    let byId = new Map<string, Node>()
    const adj = new Map<Node, Node[]>()
    let pulses: Pulse[] = []
    let dust: {
      x: number
      y: number
      r: number
      a: number
      ph: number
      vx: number
      vy: number
      hue: string
    }[] = []
    /* Метеор: редкая штриховая вспышка поперёк неба, живёт меньше секунды. */
    let meteors: { x: number; y: number; vx: number; vy: number; life: number }[] = []
    let core: Node | null = null
    let spokes: Edge[] = []
    const rings: { r: number; a: number }[] = []
    let vignette: CanvasGradient | null = null
    let beatAcc = 0
    let drift = 90
    let raf = 0
    let selected: Node | null = null
    let hovered: Node | null = null
    let filterCluster: number | null = null
    let hiddenAt = 0

    /* Поиск: единственное состояние анимации, без вложенных таймеров. */
    let search: {
      t0: number
      phase: Phase
      q: Node
      target: Node
      cands: Node[]
      packets: Packet[]
      dim: number
      ring: number
    } | null = null

    const sprites: Record<string, HTMLCanvasElement> = {}
    function sprite(hue: string) {
      if (sprites[hue]) return sprites[hue]
      const s = document.createElement('canvas')
      s.width = 48
      s.height = 48
      const g = s.getContext('2d')!
      const rg = g.createRadialGradient(24, 24, 1.5, 24, 24, 22)
      rg.addColorStop(0, `rgba(${hue},.95)`)
      rg.addColorStop(0.4, `rgba(${hue},.35)`)
      rg.addColorStop(1, `rgba(${hue},0)`)
      g.fillStyle = rg
      g.fillRect(0, 0, 48, 48)
      sprites[hue] = s
      return s
    }

    const view = { x: 0, y: 0, z: 1 }
    const spread = (z?: number) => {
      const val = z === undefined ? view.z : z
      return val >= 1 ? 1 : 1 + 2.0 * (1 - val)
    }

    function place() {
      const s = spread()
      for (const n of nodes) {
        n.x = n.cx * s + n.lx
        n.y = n.cy * s + n.ly
      }
    }

    /** Безопасная зона: панели перекрывают канвас, граф центрируем в остатке. */
    function safe() {
      const narrow = W <= 470
      const wide = W > 900
      return {
        l: 20,
        r: narrow ? 16 : wide ? 356 : 344,
        t: narrow ? 108 : 122,
        b: narrow ? Math.min(H * 0.45, 330) + 24 : 68,
      }
    }

    function pushZoom(z: number) {
      setZoom(Math.round(z * 100))
    }

    function zoomAt(sp: { x: number; y: number }, factor: number) {
      const nz = clamp(view.z * factor, 0.35, 3)
      const k = spread(nz) / spread(view.z)
      const wx = (sp.x - view.x) / view.z
      const wy = (sp.y - view.y) / view.z
      view.x = sp.x - wx * k * nz
      view.y = sp.y - wy * k * nz
      view.z = nz
      pushZoom(nz)
    }

    function centerOn(x: number, y: number, z: number) {
      const s = safe()
      view.z = z
      place()
      view.x = s.l + (W - s.l - s.r) / 2 - x * z
      view.y = s.t + (H - s.t - s.b) / 2 - y * z
      pushZoom(z)
    }

    function zoomStep(factor: number) {
      const nz = clamp(view.z * factor, 0.35, 3)
      const s = safe()
      const cxs = s.l + (W - s.l - s.r) / 2
      const cys = s.t + (H - s.t - s.b) / 2
      zoomAt({ x: cxs, y: cys }, nz / view.z)
    }

    /* Переиспользуемый bbox: ни одной аллокации на кадр/итерацию. */
    const box = { x0: 0, y0: 0, x1: 0, y1: 0 }
    function bboxAt(z: number) {
      const sp = spread(z)
      box.x0 = Infinity
      box.y0 = Infinity
      box.x1 = -Infinity
      box.y1 = -Infinity
      for (const n of nodes) {
        const x = n.cx * sp + n.lx
        const y = n.cy * sp + n.ly
        const pad = n.r + 2
        if (x - pad < box.x0) box.x0 = x - pad
        if (x + pad > box.x1) box.x1 = x + pad
        if (y - pad < box.y0) box.y0 = y - pad
        if (y + pad > box.y1) box.y1 = y + pad
      }
      return box
    }

    /** Вписать граф целиком в безопасную зону: без обрезанных кластеров. */
    function fitView() {
      if (!nodes.length) return
      const s = safe()
      const availW = Math.max(160, W - s.l - s.r)
      const availH = Math.max(160, H - s.t - s.b)
      const gutter = Math.min(48, Math.max(20, Math.min(availW, availH) * 0.08))
      const roomW = Math.max(80, availW - gutter * 2)
      const roomH = Math.max(80, availH - gutter * 2)

      const STEPS = 72
      const ZMIN = 0.35
      const ZMAX = 2
      let bestZ = 1
      let bestScore = -Infinity
      for (let i = 0; i <= STEPS; i++) {
        const z = ZMIN + (ZMAX - ZMIN) * (i / STEPS)
        const b = bboxAt(z)
        const w = Math.max(1, b.x1 - b.x0) * z
        const h = Math.max(1, b.y1 - b.y0) * z
        const ratio = Math.min(roomW / w, roomH / h)
        const score = ratio >= 1 ? z : z - (1 - ratio) * 1000
        if (score > bestScore) {
          bestScore = score
          bestZ = z
        }
      }

      view.z = bestZ
      const b = bboxAt(bestZ)
      const cx = (b.x0 + b.x1) / 2
      const cy = (b.y0 + b.y1) / 2
      view.x = s.l + availW / 2 - cx * bestZ
      view.y = s.t + availH / 2 - cy * bestZ
      place()
      pushZoom(view.z)
    }

    function pick(sp: { x: number; y: number }) {
      const wx = (sp.x - view.x) / view.z
      const wy = (sp.y - view.y) / view.z
      const rad = 10 / view.z + 4
      let best: Node | null = null
      let bd = 1e9
      for (const n of nodes) {
        const rr = Math.max(n.r, 2.4 / view.z) + 3
        const d = Math.hypot(n.x - wx, n.y - wy)
        if (d < Math.max(rr, rad) && d < bd) {
          best = n
          bd = d
        }
      }
      return best
    }

    function select(n: Node | null, found = false) {
      selected = n
      if (!n) {
        setInfo(null)
        return
      }
      if (n.core) {
        setInfo({
          id: '',
          kind: 'core',
          name: 'WORKSPACEX CORE',
          meta: `Ядро индексации: держит ${spokes.length} магистралей к кластерам сейфа и отдаёт импульсы, пока работает модель.`,
          links: spokes.length,
          power: Math.round(60000 / (search && search.phase !== 'settled' ? BEAT_FAST_MS : BEAT_MS)),
          powerLabel: 'Ритм',
          hue: WAVE,
          clusterId: null,
          cluster: 'ЛОКАЛЬНЫЙ · AES-256',
          typeLabel: 'ЯДРО',
          core: true,
        })
        return
      }
      const label = n.clusterId ? CLUSTERS[clusterIndex(n.clusterId)].label : '—'
      setInfo({
        id: n.id,
        kind: n.kind === 'note' ? 'note' : 'file',
        name: n.name,
        meta: n.meta,
        links: n.deg,
        power: Math.round(n.weight * 100),
        powerLabel: n.kind === 'note' ? 'Вес заметки' : 'Вес в сейфе',
        hue: n.hue,
        clusterId: n.clusterId,
        cluster: `кластер «${label}»`,
        typeLabel: n.kind === 'note' ? 'СТИКЕР' : kindOf(n.name),
        core: false,
        found,
      })
    }

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 1.5)
      const r = cv!.getBoundingClientRect()
      W = r.width
      H = r.height
      cv!.width = W * dpr
      cv!.height = H * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      const g = ctx!.createRadialGradient(
        W / 2,
        H / 2,
        Math.min(W, H) * 0.34,
        W / 2,
        H / 2,
        Math.max(W, H) * 0.72,
      )
      g.addColorStop(0, `rgba(${BG},0)`)
      g.addColorStop(1, `rgba(${BG},.42)`)
      vignette = g
    }

    /**
     * Сборка сцены из настоящего графа сейфа. Узлы раскладываются по сетке
     * кластеров 3×2 золотым углом — порядок детерминирован, поэтому карта не
     * «прыгает» при пересборке, а новый файл появляется рядом со своими.
     */
    function build() {
      const g = graphRef.current
      nodes = []
      edges = []
      dust = []
      byId = new Map()
      adj.clear()

      const s0 = safe()
      const av = { w: Math.max(160, W - s0.l - s0.r), h: Math.max(160, H - s0.t - s0.b) }
      const gut = Math.min(48, Math.max(20, Math.min(av.w, av.h) * 0.08))
      const BW = Math.max(120, av.w - gut * 2)
      const BH = Math.max(120, av.h - gut * 2)
      const CR = Math.min(BW / 5.8, BH / 4.2, 104)
      const gapX = Math.min((BW - CR * 2) / 2, CR * 3.4)
      const gapY = Math.min(BH - CR * 2, gapX * 1.45)
      const ox = (BW - (gapX * 2 + CR * 2)) / 2
      const oy = (BH - (gapY + CR * 2)) / 2

      /* Центры кластеров фиксированы сеткой: место кластера на карте
         не зависит от того, сколько в нём сейчас файлов. */
      const centers = CLUSTERS.map((_c, ci) => ({
        x: ox + CR + gapX * (ci % 3),
        y: oy + CR + gapY * Math.floor(ci / 3),
      }))

      const perCluster = new Array(CLUSTERS.length).fill(0)
      for (const gn of g.nodes) {
        const ring = gn.ring
        const k = perCluster[ring]++
        const total = g.nodes.filter((x) => x.ring === ring).length
        /* Радиус растёт от центра облака к краю: плотный центр, воздух снаружи. */
        const rad = CR * (total <= 1 ? 0 : 0.3 + 0.62 * Math.sqrt((k + 0.5) / total))
        const ang = k * GOLDEN + ring * 0.7
        nodes.push({
          id: gn.id,
          kind: gn.kind,
          cx: centers[ring].x,
          cy: centers[ring].y,
          lx: Math.cos(ang) * rad,
          ly: Math.sin(ang) * rad,
          vx: (Math.random() - 0.5) * 0.1,
          vy: (Math.random() - 0.5) * 0.1,
          x: 0,
          y: 0,
          r: 2.4 + gn.weight * 2.6,
          hue: CLUSTERS[ring].rgb,
          cluster: ring,
          clusterId: gn.cluster,
          name: gn.label,
          meta: gn.meta,
          weight: gn.weight,
          locked: gn.locked,
          temp: gn.temp,
          processing: gn.processing,
          glow: (k * 1.7 + ring) % (Math.PI * 2),
          deg: 0,
          hot: 0,
        })
      }
      for (const n of nodes) byId.set(n.id, n)

      /* Связи не выдумываются: берём ровно те, что посчитал graph.ts. */
      for (const ge of g.edges) {
        const a = nodes[ge.a]
        const b = nodes[ge.b]
        if (!a || !b) continue
        edges.push({
          a,
          b,
          w: ge.w,
          same: ge.same,
          bow: ((ge.a * 37 + ge.b * 17) % 19) - 9,
        })
      }

      /* Звёздное поле канваса поверх CSS-космоса: даёт параллакс при панораме. */
      const STAR_TINT = ['230,238,255', '198,220,255', '255,236,208', '208,255,236']
      const count = Math.round(clamp((W * H) / 12000, 60, 150))
      for (let i = 0; i < count; i++) {
        const big = Math.random() < 0.12
        dust.push({
          x: Math.random() * W * 1.7 - W * 0.35,
          y: Math.random() * H * 1.7 - H * 0.35,
          r: big ? 1.1 + Math.random() * 1.1 : 0.35 + Math.random() * 0.8,
          a: big ? 0.24 + Math.random() * 0.3 : 0.06 + Math.random() * 0.16,
          ph: Math.random() * 7,
          vx: (Math.random() - 0.5) * 0.04,
          vy: (Math.random() - 0.5) * 0.04,
          hue: big ? STAR_TINT[Math.floor(Math.random() * STAR_TINT.length)] : '226,234,245',
        })
      }
      drift = CR + 14

      core = {
        id: '',
        kind: 'core',
        cx: BW / 2,
        cy: BH / 2,
        lx: 0,
        ly: 0,
        vx: 0,
        vy: 0,
        x: 0,
        y: 0,
        r: 7,
        hue: WAVE,
        cluster: -1,
        clusterId: null,
        core: true,
        name: 'WORKSPACEX CORE',
        meta: 'Ядро индексации · связывает все кластеры',
        weight: 1,
        locked: false,
        temp: false,
        processing: false,
        glow: 0,
        deg: 0,
        hot: 0,
      }
      nodes.push(core)

      /* Магистрали к ядру — только к непустым кластерам: ядро не тянет линии
         в пустоту, если в сейфе нет ни одной картинки. */
      spokes = []
      CLUSTERS.forEach((_cl, ci) => {
        const near = nodes
          .filter((n) => n.cluster === ci)
          .sort(
            (a, b) =>
              Math.hypot(a.cx + a.lx - core!.cx, a.cy + a.ly - core!.cy) -
              Math.hypot(b.cx + b.lx - core!.cx, b.cy + b.ly - core!.cy),
          )
          .slice(0, 2)
        for (const n of near) {
          spokes.push({
            a: core!,
            b: n,
            w: 0.95,
            same: false,
            bow: ((ci * 13) % 11) - 5,
            spoke: true,
          })
        }
      })
      edges.push(...spokes)

      for (const n of nodes) {
        n.deg = 0
        adj.set(n, [])
      }
      for (const e of edges) {
        e.a.deg++
        e.b.deg++
        adj.get(e.a)!.push(e.b)
        adj.get(e.b)!.push(e.a)
      }
      /* Степень связности добавляется к радиусу: хабы читаются сразу. */
      for (const n of nodes) {
        if (!n.core) n.r = 2.1 + n.weight * 2.2 + Math.min(n.deg, 12) * 0.22
      }
    }

    /* ---------- Волна активации ---------- */
    /* Ручной выбор узла сильнее автоматики: волна анимируется, но карточку
       в инспекторе не подменяет, пока пользователь сам не закроет её. */
    let userPinned = false
    let waveSeq = 0
    let rotate = 0
    let lastInteract = 0
    let autoTimer = 0

    function startSearch(instant = false, explicit: Node | null = null) {
      const sd = seedRef.current
      if (!core || nodes.length < 3) return
      const target = explicit ?? (sd.targetId ? byId.get(sd.targetId) : null) ?? null
      if (!target) return
      const ring = target.cluster
      const family = nodes.filter((n) => n.cluster === ring && !n.core)
      const q =
        family.length > 1
          ? family.reduce((a, b) =>
              Math.hypot(b.cx + b.lx - core!.cx, b.cy + b.ly - core!.cy) >
              Math.hypot(a.cx + a.lx - core!.cx, a.cy + a.ly - core!.cy)
                ? b
                : a,
            )
          : target
      const pool = family.filter((n) => n !== target && n !== q)
      const packets: Packet[] = [{ a: q, b: core!, t: 0, sp: 0, keep: true, fade: 1 }]
      for (const c of [target, ...pool]) {
        packets.push({ a: core!, b: c, t: 0, sp: 0, keep: c === target, fade: 1 })
      }
      search = {
        t0: instant ? performance.now() - SEARCH_END : performance.now(),
        phase: instant ? 'settled' : 'query',
        q,
        target,
        cands: pool,
        packets,
        dim: 0,
        ring,
      }
      setPhase(search.phase)
      setCands(instant ? 1 : pool.length + 1)
      waveSeq++
      setWave({
        seq: waveSeq,
        query: sd.raw || target.name,
        clusterLabel: CLUSTERS[clusterIndex(target.clusterId ?? 'misc')].label,
        target: target.name,
      })
      if (instant && !userPinned) select(target, true)
    }

    /** Кого исследовать в следующей волне: сначала живой поиск, потом хабы. */
    function autoTarget(): Node | null {
      const m = matchedRef.current
      if (m.size > 0) {
        const hits = nodes.filter((n) => !n.core && m.has(n.id))
        if (hits.length) return hits[rotate++ % hits.length]
      }
      const sd = seedRef.current
      if (sd.raw && sd.targetId) {
        const t = byId.get(sd.targetId)
        if (t) return t
      }
      const pool = nodes
        .filter((n) => !n.core && n.deg > 0 && (filterCluster === null || n.cluster === filterCluster))
        .sort((a, b) => b.deg - a.deg)
      if (!pool.length) return null
      const top = pool.slice(0, Math.min(14, Math.max(4, Math.round(pool.length * 0.4))))
      return top[rotate++ % top.length]
    }

    /* Планировщик: волны идут сами, но уступают живому взаимодействию —
       пока тянут карту или ведут курсор по узлам, автоматика ждёт. */
    function scheduleAuto(delay = AUTO_GAP) {
      clearTimeout(autoTimer)
      /* prefers-reduced-motion: волны продолжают идти, но без анимации —
         состояние сразу «найдено», журнал и инспектор живут как обычно. */
      autoTimer = window.setTimeout(runAuto, reduced ? Math.max(delay, 6000) : delay)
    }

    function runAuto() {
      if (document.hidden || drag || hovered || performance.now() - lastInteract < IDLE_GUARD) {
        scheduleAuto(1200)
        return
      }
      const t = autoTarget()
      if (!t) {
        scheduleAuto(AUTO_GAP)
        return
      }
      search = null
      startSearch(reduced, t)
      scheduleAuto(SEARCH_END + AUTO_GAP)
    }

    function stopSearch() {
      if (!search) return
      for (const n of nodes) n.hot = 0
      search = null
      setPhase('idle')
    }

    function spawnPulse() {
      if (reduced || !edges.length || pulses.length >= 12) return
      const n = Math.random() < 0.3 ? 2 : 1
      for (let i = 0; i < n && pulses.length < 12; i++) {
        const e = edges[Math.floor(Math.random() * edges.length)]
        pulses.push({
          e,
          t: 0,
          sp: 0.01 + Math.random() * 0.012,
          hue: e.same ? e.a.hue : WAVE,
          head: 1.9 + Math.random() * 1.2,
        })
      }
    }
    const pulseTimer = setInterval(spawnPulse, 650)

    /* Метеор раз в ~18 секунд: небо живое, но внимание не перетягивает. */
    const meteorTimer = setInterval(() => {
      if (reduced || document.hidden || Math.random() > 0.55 || meteors.length > 1) return
      const fromLeft = Math.random() < 0.7
      meteors.push({
        x: fromLeft ? -80 : Math.random() * W * 0.6,
        y: Math.random() * H * 0.45,
        vx: 0.26 + Math.random() * 0.16,
        vy: 0.1 + Math.random() * 0.09,
        life: 2600,
      })
    }, 9000)

    function qpoint(e: Edge, u: number) {
      const iu = 1 - u
      return {
        x: iu * iu * e.a.x + 2 * iu * u * (e.qx ?? 0) + u * u * e.b.x,
        y: iu * iu * e.a.y + 2 * iu * u * (e.qy ?? 0) + u * u * e.b.y,
      }
    }

    function drawComet(p: Pulse) {
      const segs = 8
      const tail = 0.3
      for (let k = 0; k < segs; k++) {
        const u0 = Math.max(0, p.t - tail * (k / segs))
        const u1 = Math.max(0, p.t - tail * ((k + 1) / segs))
        if (u1 >= u0) continue
        const s0 = qpoint(p.e, u0)
        const s1 = qpoint(p.e, u1)
        const f = 1 - k / segs
        ctx!.strokeStyle = `rgba(${p.hue},${(0.55 * f * f).toFixed(3)})`
        ctx!.lineWidth = 1.8 * f + 0.3
        ctx!.beginPath()
        ctx!.moveTo(s1.x, s1.y)
        ctx!.lineTo(s0.x, s0.y)
        ctx!.stroke()
      }
      const h = qpoint(p.e, p.t)
      ctx!.beginPath()
      ctx!.arc(h.x, h.y, p.head, 0, 7)
      ctx!.fillStyle = `rgba(${p.hue},.95)`
      ctx!.fill()
    }

    /** Пакет по прямой с коротким хвостом: без shadowBlur, без аллокаций. */
    function drawPacket(p: Packet, u: number, alpha: number) {
      const e = easeInOut(clamp(u, 0, 1))
      for (let k = 2; k >= 0; k--) {
        const uu = e - k * 0.07
        if (uu < 0) continue
        const x = p.a.x + (p.b.x - p.a.x) * uu
        const y = p.a.y + (p.b.y - p.a.y) * uu
        const f = (1 - k / 3) * alpha
        ctx!.beginPath()
        ctx!.arc(x, y, 2.4 - k * 0.6, 0, 7)
        ctx!.fillStyle = `rgba(${WAVE},${(f * 0.9).toFixed(3)})`
        ctx!.fill()
      }
    }

    function nodeAlpha(n: Node, now: number) {
      const breathe = reduced ? 0.85 : 0.72 + Math.sin(n.glow) * 0.18
      const off = filterCluster !== null && !n.core && n.cluster !== filterCluster ? 0.2 : 1
      /* Живой поиск из шапки: не попавшие в результат уходят на второй план. */
      const m = matchedRef.current
      const q = m.size > 0 && !n.core && n.kind === 'file' && !m.has(n.id) ? 0.3 : 1
      return clamp(breathe * off * q, 0.06, 1) * (0.9 + 0.1 * Math.sin(now * 0.001))
    }

    function drawNode(n: Node, alpha: number, scale: number) {
      const rr = Math.max(n.r, 2.4 / view.z) * scale
      const R = rr * 3.2
      ctx!.globalAlpha = alpha
      ctx!.drawImage(sprite(n.hue), n.x - R, n.y - R, R * 2, R * 2)
      ctx!.globalAlpha = 1
      /* Стикер с таймером — пунктирный контур: видно, что он растает. */
      if (n.temp) ctx!.setLineDash([2, 2])
      ctx!.beginPath()
      ctx!.arc(n.x, n.y, rr, 0, 7)
      ctx!.lineWidth = 1
      ctx!.strokeStyle = `rgba(${n.hue},${Math.min(0.9, alpha + 0.22)})`
      ctx!.stroke()
      ctx!.setLineDash([])
      /* Стикер отличается от файла квадратной серединой, а не только цветом. */
      if (n.kind === 'note') {
        const h = rr * 0.62
        ctx!.beginPath()
        ctx!.rect(n.x - h, n.y - h, h * 2, h * 2)
        ctx!.strokeStyle = `rgba(${n.hue},${Math.min(0.85, alpha + 0.1)})`
        ctx!.stroke()
      }
      if (n.processing) {
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, rr + 3, n.glow, n.glow + 2.2)
        ctx!.strokeStyle = `rgba(${WAVE},.7)`
        ctx!.lineWidth = 1.2
        ctx!.stroke()
      }
      if (n.core) {
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, 2.6, 0, 7)
        ctx!.fillStyle = 'rgba(230,255,242,.95)'
        ctx!.fill()
      }
      return rr
    }

    function edgeStroke(e: Edge) {
      if (e.spoke) return 'rgba(47,190,126,.2)'
      const off =
        filterCluster !== null && e.a.cluster !== filterCluster && e.b.cluster !== filterCluster
          ? 0.25
          : 1
      return `rgba(255,255,255,${(0.05 + e.w * 0.16) * off})`
    }

    let last = performance.now()
    let drawCost = 8
    let lastDraw = 0
    function tick(now: number) {
      /* Сцена перерисовывается целиком, и на слабой видеоподсистеме кадр
         не укладывается в 16 мс. Тогда карта честно идёт на 30 к/с: движение
         остаётся плавным, а браузер перестаёт захлёбываться — прокрутка
         панелей поверх карты снова живая. */
      const budget = drawCost > 12 ? 30 : 15
      if (frozen || now - lastDraw < budget) {
        raf = requestAnimationFrame(tick)
        return
      }
      lastDraw = now
      const frameT0 = performance.now()
      const dt = Math.min(32, now - last)
      last = now
      ctx!.fillStyle = MAP_BG
      ctx!.fillRect(0, 0, W, H)
      place()

      if (!reduced) {
        const lim = drift
        for (const n of nodes) {
          n.lx += n.vx
          n.ly += n.vy
          n.glow += 0.02
          if (Math.abs(n.lx) > lim) n.vx *= -1
          if (Math.abs(n.ly) > lim) n.vy *= -1
        }
        for (const d of dust) {
          d.x += d.vx
          d.y += d.vy
          if (d.x < -W * 0.35) d.x = W * 1.35
          if (d.x > W * 1.35) d.x = -W * 0.35
          if (d.y < -H * 0.35) d.y = H * 1.35
          if (d.y > H * 1.35) d.y = -H * 0.35
        }
      }

      for (const e of edges) if (e.glow) e.glow = Math.max(0, e.glow - dt * 0.0011)

      /* ---- фаза поиска: одна точка правды ---- */
      let st = 0
      if (search) {
        st = now - search.t0
        const ph = phaseAt(st)
        if (ph !== search.phase) {
          search.phase = ph
          setPhase(ph)
          if (ph === 'found') setCands(1)
          if (ph === 'settled' && !userPinned) select(search.target, true)
        }
        if (ph === 'filter') {
          const start = search.cands.length + 1
          const k = clamp((st - 500) / 300, 0, 1)
          const left = Math.max(1, Math.round(start - k * (start - 1)))
          setCands((c) => (c === left ? c : left))
        }
        search.dim =
          st < 2000
            ? clamp(st / 160, 0, 0.5)
            : clamp(0.5 * (1 - (st - 2000) / 700), 0, 0.5)
        for (const n of nodes) n.hot = 0
        if (st >= 0) search.q.hot = 1
        if (st >= 180 && core) core.hot = 1
        if (st >= 200) {
          const flash = clamp((st - 200) / 200, 0, 1)
          for (const n of nodes)
            if (n.cluster === search.ring) n.hot = Math.max(n.hot, 0.3 + flash * 0.55)
        }
        if (st >= 500) {
          for (let i = 0; i < search.cands.length; i++) {
            const die = 620 + i * 34
            const c = search.cands[i]
            c.hot = st < die ? 1 : Math.max(0, 1 - (st - die) / 180)
          }
        }
        search.target.hot = 1
        if (st > SEARCH_END + 400) {
          for (const n of nodes) n.hot = 0
          search.dim = 0
        }
      }

      /* ---- ховер: тот же механизм притухания ---- */
      let dim = search ? search.dim : 0
      if (!search && hovered) {
        dim = 0.55
        for (const n of nodes) n.hot = 0
        hovered.hot = 1
        for (const nb of adj.get(hovered) || []) nb.hot = 0.85
      } else if (!search && !hovered) {
        for (const n of nodes) if (n.hot) n.hot = Math.max(0, n.hot - dt * 0.004)
      }

      /* ---- звёздное поле ---- */
      for (const d of dust) {
        const sx = d.x * view.z * 0.55 + view.x * 0.8
        const sy = d.y * view.z * 0.55 + view.y * 0.8
        if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue
        const tw = reduced ? 0.75 : 0.55 + 0.45 * Math.sin(d.ph + now * 0.0011)
        ctx!.globalAlpha = d.a * tw
        ctx!.beginPath()
        ctx!.arc(sx, sy, d.r, 0, 7)
        ctx!.fillStyle = `rgba(${d.hue},1)`
        ctx!.fill()
        /* Крупные звёзды получают короткие лучи — небо перестаёт быть «точками». */
        if (d.r > 1) {
          ctx!.globalAlpha = d.a * tw * 0.5
          ctx!.strokeStyle = `rgba(${d.hue},1)`
          ctx!.lineWidth = 0.6
          const l = d.r * 2.6
          ctx!.beginPath()
          ctx!.moveTo(sx - l, sy)
          ctx!.lineTo(sx + l, sy)
          ctx!.moveTo(sx, sy - l)
          ctx!.lineTo(sx, sy + l)
          ctx!.stroke()
        }
      }
      ctx!.globalAlpha = 1

      /* ---- метеоры ---- */
      for (let k = meteors.length - 1; k >= 0; k--) {
        const m = meteors[k]
        m.x += m.vx * dt
        m.y += m.vy * dt
        m.life -= dt
        if (m.life <= 0 || m.x > W + 120 || m.y > H + 120) {
          meteors.splice(k, 1)
          continue
        }
        const tail = 74
        const g = ctx!.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail)
        g.addColorStop(0, 'rgba(236,244,255,.75)')
        g.addColorStop(1, 'rgba(236,244,255,0)')
        ctx!.strokeStyle = g
        ctx!.lineWidth = 1.2
        ctx!.beginPath()
        ctx!.moveTo(m.x, m.y)
        ctx!.lineTo(m.x - m.vx * tail, m.y - m.vy * tail)
        ctx!.stroke()
      }

      /* ---- пульс ядра ---- */
      beatAcc += dt
      const beatMs = search && search.phase !== 'settled' ? BEAT_FAST_MS : BEAT_MS
      if (beatAcc >= beatMs && core) {
        beatAcc = 0
        core.flash = 1
        rings.push({ r: core.r + 3, a: 0.5 })
        if (!reduced && spokes.length && pulses.length < 14) {
          const sp = spokes[Math.floor(Math.random() * spokes.length)]
          pulses.push({ e: sp, t: 0, sp: 0.014, hue: WAVE, head: 2.2 })
        }
      }
      for (let k = rings.length - 1; k >= 0; k--) {
        rings[k].r += dt * 0.03
        rings[k].a -= dt * 0.00045
        if (rings[k].a <= 0) rings.splice(k, 1)
      }

      /* ================= базовый проход ================= */
      ctx!.save()
      ctx!.translate(view.x, view.y)
      ctx!.scale(view.z, view.z)

      for (const e of edges) {
        const mx = (e.a.x + e.b.x) / 2
        const my = (e.a.y + e.b.y) / 2
        const dx = e.b.x - e.a.x
        const dy = e.b.y - e.a.y
        const L = Math.hypot(dx, dy) || 1
        e.qx = mx - (dy / L) * e.bow
        e.qy = my + (dx / L) * e.bow
        ctx!.beginPath()
        ctx!.moveTo(e.a.x, e.a.y)
        ctx!.quadraticCurveTo(e.qx, e.qy, e.b.x, e.b.y)
        ctx!.strokeStyle = edgeStroke(e)
        ctx!.lineWidth = e.spoke ? 1.1 : 0.6 + e.w * 1.1
        ctx!.stroke()
        const eg = e.glow || 0
        if (eg > 0.02) {
          ctx!.strokeStyle = `rgba(${e.lastHue || WAVE},${(eg * 0.4).toFixed(3)})`
          ctx!.lineWidth = 1 + eg * 1.2
          ctx!.stroke()
        }
      }

      if (core) {
        for (const rg of rings) {
          ctx!.beginPath()
          ctx!.arc(core.x, core.y, rg.r, 0, 7)
          ctx!.strokeStyle = `rgba(${WAVE},${rg.a.toFixed(3)})`
          ctx!.lineWidth = 1
          ctx!.stroke()
        }
      }

      for (const n of nodes) {
        const rr = drawNode(n, nodeAlpha(n, now), 1)
        if (n === selected) {
          ctx!.beginPath()
          ctx!.arc(n.x, n.y, rr + 6, 0, 7)
          ctx!.strokeStyle = 'rgba(47,190,126,.9)'
          ctx!.lineWidth = 1.5
          ctx!.stroke()
        }
        if (n.flash && n.flash > 0) {
          ctx!.beginPath()
          ctx!.arc(n.x, n.y, rr + 2 + (1 - n.flash) * 9, 0, 7)
          ctx!.strokeStyle = `rgba(${n.hue},${(n.flash * 0.55).toFixed(3)})`
          ctx!.lineWidth = 1
          ctx!.stroke()
          n.flash = Math.max(0, n.flash - dt * 0.0022)
        }
      }

      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k]
        p.t += p.sp
        if (p.t >= 1) {
          p.e.b.flash = 1
          pulses.splice(k, 1)
          continue
        }
        p.e.glow = Math.max(p.e.glow || 0, 0.9)
        p.e.lastHue = p.hue
        drawComet(p)
      }
      ctx!.restore()

      /* ============ композитный проход подсветки ============ */
      if (dim > 0.02) {
        ctx!.fillStyle = `rgba(${BG},${dim.toFixed(3)})`
        ctx!.fillRect(0, 0, W, H)

        ctx!.save()
        ctx!.translate(view.x, view.y)
        ctx!.scale(view.z, view.z)

        for (const e of edges) {
          const h = Math.min(e.a.hot, e.b.hot)
          if (h < 0.05) continue
          ctx!.beginPath()
          ctx!.moveTo(e.a.x, e.a.y)
          ctx!.quadraticCurveTo(e.qx!, e.qy!, e.b.x, e.b.y)
          ctx!.strokeStyle = `rgba(${WAVE},${(0.1 + h * 0.35).toFixed(3)})`
          ctx!.lineWidth = 1
          ctx!.stroke()
        }

        for (const n of nodes) {
          if (n.hot < 0.05) continue
          const isTarget = search && n === search.target && search.phase !== 'idle'
          const grow = isTarget ? 1 + 0.9 * clamp((st - 800) / 260, 0, 1) : 1
          const rr = drawNode(n, clamp(n.hot, 0.2, 1), grow)
          if (isTarget && st >= 800) {
            const pulse = ((st - 800) % 900) / 900
            ctx!.beginPath()
            ctx!.arc(n.x, n.y, rr + 4 + pulse * 14, 0, 7)
            ctx!.strokeStyle = `rgba(${WAVE},${((1 - pulse) * 0.6).toFixed(3)})`
            ctx!.lineWidth = 1.4
            ctx!.stroke()
          }
        }

        /* ореол кластера — одна расширяющаяся окружность */
        if (search && st >= 200 && st < 900) {
          const k = clamp((st - 200) / 600, 0, 1)
          const c = nodes.find((n) => n.cluster === search!.ring)
          if (c) {
            ctx!.beginPath()
            ctx!.arc(c.cx * spread(), c.cy * spread(), 20 + k * 150, 0, 7)
            ctx!.strokeStyle = `rgba(${WAVE},${((1 - k) * 0.5).toFixed(3)})`
            ctx!.lineWidth = 1.5
            ctx!.stroke()
          }
        }

        /* пакеты: запрос → ядро, затем ядро → кандидаты */
        if (search && !reduced) {
          const p0 = search.packets[0]
          if (st < 460) drawPacket(p0, st / 220, clamp(1 - (st - 220) / 240, 0, 1))
          if (st >= 500 && st < 1000) {
            for (let i = 1; i < search.packets.length; i++) {
              const p = search.packets[i]
              const t0 = 500 + i * 12
              const u = (st - t0) / 300
              if (u < 0 || u > 1.2) continue
              drawPacket(p, u, p.keep ? 1 : clamp(1 - (u - 0.7) / 0.5, 0, 1))
            }
          }
        }
        ctx!.restore()
      }

      /* ---- виньетка ---- */
      if (vignette) {
        ctx!.fillStyle = vignette
        ctx!.fillRect(0, 0, W, H)
      }

      /* ---- подписи с LOD ---- */
      ctx!.font = '10px "IBM Plex Mono",monospace'
      /* Подписи кластеров держатся до 1.3× — на дефолтном масштабе карта
         сразу читается по названиям, а не только по цветам. */
      if (view.z < 1.3) {
        const a = clamp((1.32 - view.z) / 0.3, 0.35, 1) * 0.85
        const s = spread()
        const seen = new Set<number>()
        for (const n of nodes) {
          if (n.core || seen.has(n.cluster)) continue
          seen.add(n.cluster)
          const sx = n.cx * s * view.z + view.x
          const sy = n.cy * s * view.z + view.y
          const name = CLUSTERS[n.cluster].label.toUpperCase()
          const tw = ctx!.measureText(name).width
          const off = filterCluster !== null && n.cluster !== filterCluster ? 0.35 : 1
          ctx!.fillStyle = `rgba(230,234,238,${(a * 0.8 * off).toFixed(3)})`
          ctx!.fillText(name, sx - tw / 2, sy - 4)
          ctx!.fillStyle = `rgba(${n.hue},${(a * 0.75 * off).toFixed(3)})`
          ctx!.fillRect(sx - tw / 2, sy + 2, tw, 1)
        }
      } else {
        const a = clamp((view.z - 1.3) / 0.3, 0, 1) * 0.72
        let drawn = 0
        for (const n of nodes) {
          if (drawn > 28) break
          if (n.core) continue
          const sx = n.x * view.z + view.x
          const sy = n.y * view.z + view.y
          if (sx < 8 || sx > W - 8 || sy < 8 || sy > H - 8) continue
          ctx!.fillStyle = `rgba(230,234,238,${a.toFixed(3)})`
          ctx!.fillText(n.name, sx + 8, sy + 3)
          drawn++
        }
      }

      /* ---- подпись под курсором / выбранным ---- */
      const label =
        hovered || (search && search.phase !== 'idle' ? search.target : null) || selected
      if (label) {
        const sx = label.x * view.z + view.x
        const sy = label.y * view.z + view.y
        ctx!.font = '11px "IBM Plex Mono",monospace'
        const found =
          search && label === search.target && (search.phase === 'found' || search.phase === 'settled')
        const text = found ? `${label.name} · найдено` : label.name
        const tw = ctx!.measureText(text).width
        const bx = clamp(sx + 12, 8, Math.max(8, W - tw - 24))
        const by = clamp(sy - 24, 8, Math.max(8, H - 28))
        ctx!.fillStyle = 'rgba(11,14,18,.94)'
        ctx!.strokeStyle = found ? 'rgba(47,190,126,.55)' : 'rgba(255,255,255,.16)'
        ctx!.lineWidth = 1
        ctx!.beginPath()
        if (typeof ctx!.roundRect === 'function') ctx!.roundRect(bx, by, tw + 16, 22, 3)
        else ctx!.rect(bx, by, tw + 16, 22)
        ctx!.fill()
        ctx!.stroke()
        ctx!.fillStyle = found || label === selected ? 'rgba(47,190,126,1)' : 'rgba(230,234,238,.92)'
        ctx!.fillText(text, bx + 8, by + 15)
      }

      drawCost = drawCost * 0.85 + (performance.now() - frameT0) * 0.15
      raf = requestAnimationFrame(tick)
    }

    /* ---------- Ввод: pan / zoom / выбор узла ---------- */
    let drag: { x: number; y: number; vx: number; vy: number } | null = null
    let moved = false
    let pinch: { d: number; z: number } | null = null
    const stagePos = (e: { clientX: number; clientY: number }) => {
      const r = cv!.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onDown = (e: MouseEvent) => {
      lastInteract = performance.now()
      const p = stagePos(e)
      drag = { x: p.x, y: p.y, vx: view.x, vy: view.y }
      moved = false
      cv!.style.cursor = 'grabbing'
    }
    const onMove = (e: MouseEvent) => {
      /* Курсор над плавающей панелью (инспектор, легенда): читать геометрию
         канваса на каждый шаг мыши незачем — getBoundingClientRect внутри
         прокрутки панели заставлял браузер пересчитывать раскладку и давал
         рывки. Карта в это время просто не подсвечивает узлы. */
      if (!drag && e.target !== cv) {
        hovered = null
        return
      }
      const sp = stagePos(e)
      if (drag) {
        const dx = sp.x - drag.x
        const dy = sp.y - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
        view.x = drag.vx + dx
        view.y = drag.vy + dy
      } else {
        hovered = pick(sp)
        if (hovered) lastInteract = performance.now()
        cv!.style.cursor = hovered ? 'pointer' : 'grab'
      }
    }
    const onUp = (e: MouseEvent) => {
      if (!drag) return
      cv!.style.cursor = 'grab'
      drag = null
      lastInteract = performance.now()
      if (!moved && e.target === cv) {
        const n = pick(stagePos(e))
        if (n) stopSearch()
        userPinned = Boolean(n)
        select(n)
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      lastInteract = performance.now()
      zoomAt(stagePos(e), e.deltaY < 0 ? 1.12 : 0.89)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0]
        drag = { x: t.clientX, y: t.clientY, vx: view.x, vy: view.y }
        moved = false
      } else if (e.touches.length === 2) {
        drag = null
        pinch = {
          d: Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          ),
          z: view.z,
        }
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 1 && drag) {
        const t = e.touches[0]
        const dx = t.clientX - drag.x
        const dy = t.clientY - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true
        view.x = drag.vx + dx
        view.y = drag.vy + dy
      } else if (e.touches.length === 2 && pinch) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        )
        const r = cv!.getBoundingClientRect()
        zoomAt(
          {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
          },
          ((d / pinch.d) * pinch.z) / view.z,
        )
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      lastInteract = performance.now()
      if (drag && !moved && e.changedTouches.length) {
        const t = e.changedTouches[0]
        const r = cv!.getBoundingClientRect()
        const n = pick({ x: t.clientX - r.left, y: t.clientY - r.top })
        if (n) stopSearch()
        userPinned = Boolean(n)
        select(n)
      }
      drag = null
      pinch = null
    }
    /* Размер сцены меняет не только окно: сворачивание сайдбара тянет канвас
       за собой 180 мс подряд. Раньше карта продолжала рисовать полный кадр
       поверх каждого шага раскладки — анимация меню шла рывками, а бит-мап
       оставался старого размера и растягивался. Теперь на время движения
       кадр замирает, а после того как размер устоялся, сцена пересобирается
       один раз с сохранением выбранного узла. */
    let frozen = false
    let settleTimer = 0
    function relayout() {
      const keep = selected && !selected.core ? selected.id : null
      const wasCore = Boolean(selected?.core)
      /* Пересборку рвём на два кадра: тяжёлый build() не должен ложиться в
         один синхронный таск с resize() — иначе в конце анимации меню виден
         единичный спайк ~200 мс. */
      resize()
      requestAnimationFrame(() => {
        build()
        fitView()
        stopSearch()
        const again = keep ? byId.get(keep) : null
        select(again ?? (wasCore || !keep ? core : null))
        frozen = false
        lastDraw = 0
      })
    }
    let firstObserve = true
    const ro = new ResizeObserver(() => {
      if (firstObserve) {
        firstObserve = false
        return
      }
      frozen = true
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(relayout, 90)
    })
    /* Не жжём CPU в фоне: сдвигаем начало таймлайна на время простоя. */
    const onVis = () => {
      if (document.hidden) hiddenAt = performance.now()
      else if (hiddenAt) {
        if (search) search.t0 += performance.now() - hiddenAt
        scheduleAuto(1500)
      }
    }

    cv.addEventListener('mousedown', onDown)
    addEventListener('mousemove', onMove)
    addEventListener('mouseup', onUp)
    cv.addEventListener('wheel', onWheel, { passive: false })
    cv.addEventListener('touchstart', onTouchStart, { passive: true })
    cv.addEventListener('touchmove', onTouchMove, { passive: false })
    cv.addEventListener('touchend', onTouchEnd)
    ro.observe(cv)
    document.addEventListener('visibilitychange', onVis)

    api.current = {
      zoomIn: () => zoomStep(1.25),
      zoomOut: () => zoomStep(0.8),
      reset: () => centerOn(core ? core.x : 0, core ? core.y : 0, 1),
      fit: fitView,
      wave: (id) => {
        const t = id ? byId.get(id) ?? null : autoTarget()
        if (!t) return
        search = null
        startSearch(false, t)
        scheduleAuto(SEARCH_END + AUTO_GAP)
      },
      clear: () => {
        userPinned = false
        select(null)
      },
      core: () => select(core),
      filter: (ci) => {
        filterCluster = ci
        if (ci === null) fitView()
        else {
          const n = nodes.find((x) => x.cluster === ci)
          if (n) centerOn(n.cx * spread(), n.cy * spread(), 1.2)
        }
      },
      focusIds: (ids) => {
        stopSearch()
        const fresh = ids.map((id) => byId.get(id)).filter((n): n is Node => Boolean(n))
        if (!fresh.length) return
        let sx = 0
        let sy = 0
        for (const n of fresh) {
          n.flash = 1
          n.hot = 1
          sx += n.x
          sy += n.y
        }
        centerOn(sx / fresh.length, sy / fresh.length, 1.5)
        select(fresh[0])
      },
      /* Сейф изменился — пересобираем сцену, сохраняя выбранный узел. */
      rebuild: () => {
        scheduleAuto(1600)
        const keep = selected && !selected.core ? selected.id : null
        const wasCore = Boolean(selected?.core)
        build()
        fitView()
        stopSearch()
        const again = keep ? byId.get(keep) : null
        select(again ?? (wasCore || !keep ? core : null))
      },
      select: (id) => {
        const n = byId.get(id)
        if (!n) return
        stopSearch()
        userPinned = true
        n.flash = 1
        centerOn(n.x, n.y, 1.5)
        select(n)
      },
    }

    resize()
    build()
    fitView()
    select(core)
    raf = requestAnimationFrame(tick)

    /* Карта показывает поиск сама: первая волна через мгновение после сборки,
       дальше — бесконечный спокойный поток с паузами. */
    scheduleAuto(900)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(autoTimer)
      clearInterval(pulseTimer)
      clearInterval(meteorTimer)
      cv.removeEventListener('mousedown', onDown)
      removeEventListener('mousemove', onMove)
      removeEventListener('mouseup', onUp)
      cv.removeEventListener('wheel', onWheel)
      cv.removeEventListener('touchstart', onTouchStart)
      cv.removeEventListener('touchmove', onTouchMove)
      cv.removeEventListener('touchend', onTouchEnd)
      ro.disconnect()
      window.clearTimeout(settleTimer)
      document.removeEventListener('visibilitychange', onVis)
      api.current = null
    }
  }, [])

  const call = useCallback(
    (fn: 'zoomIn' | 'zoomOut' | 'reset' | 'fit' | 'clear' | 'core') => {
      api.current?.[fn]()
    },
    [],
  )

  /* Сейф изменился — карта пересобирается. Файл, добавленный в библиотеке,
     появляется здесь новым узлом, сгоревший стикер исчезает вместе со связями. */
  const graphKey = `${graph.nodes.map((n) => n.id).join(',')}|${graph.links}`
  useEffect(() => {
    api.current?.rebuild()
  }, [graphKey])

  /* Фильтр кластера прокидываем в движок */
  useEffect(() => {
    api.current?.filter(cluster === 'all' ? null : clusterIndex(cluster))
  }, [cluster])

  /* Живой поиск в шапке — карта сразу ведёт волну к верхнему результату:
     смотреть, как ищется файл, можно не нажимая ничего. */
  useEffect(() => {
    if (!seed.raw || !seed.targetId) return
    const id = setTimeout(() => api.current?.wave(seed.targetId ?? undefined), 260)
    return () => clearTimeout(id)
  }, [seed.raw, seed.targetId])

  /* Журнал наблюдения: последние найденные цели остаются в инспекторе. */
  useEffect(() => {
    if (phase !== 'found' || !wave) return
    setHistory((h) =>
      [{ name: wave.target, cluster: wave.clusterLabel, at: Date.now() }, ...h.filter((x) => x.name !== wave.target)].slice(0, 3),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, wave?.seq])

  /* Переход «показать на карте» из библиотеки, чата или палитры Ctrl+K. */
  useEffect(() => {
    if (!NAV.clusterFocus) return
    setCluster(NAV.clusterFocus.id as ClusterId | 'all')
  }, [NAV.clusterFocus])

  useEffect(() => {
    if (!NAV.nodeFocus) return
    api.current?.select(NAV.nodeFocus.id)
  }, [NAV.nodeFocus, graphKey])

  /* Горячие клавиши: + − 0 F, Esc — закрыть инспектор */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey) return
      if (e.key === '+' || e.key === '=') call('zoomIn')
      else if (e.key === '-' || e.key === '_') call('zoomOut')
      else if (e.key === '0') call('reset')
      else if (e.code === 'KeyF') call('fit')
      else if (e.key === 'Escape') call('clear')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [call])

  /* Фокус на шапку инспектора при открытии карточки */
  useEffect(() => {
    if (info) headRef.current?.focus()
  }, [info?.name])

  /* Фильтр кластеров: подписи и счётчики — из живого графа. */
  const clusterOptions = useMemo<DropdownOption[]>(() => {
    const live = D.clusters.filter((c) => c.count > 0)
    return [
      {
        value: 'all',
        label: 'Все кластеры',
        note: 'Полный граф без фильтра',
        meta: String(graph.nodes.length),
      },
      ...live.map((c) => ({
        value: c.id,
        label: c.label,
        note: `${c.note} · ${c.links} внутренних связей`,
        meta: String(c.count),
      })),
    ]
  }, [D.clusters, graph.nodes.length])

  /* Кластер мог опустеть (файл удалён) — фильтр не должен показывать пустоту. */
  useEffect(() => {
    if (cluster !== 'all' && !clusterOptions.some((o) => o.value === cluster)) setCluster('all')
  }, [clusterOptions, cluster])

  const playing = phase !== 'idle' && phase !== 'settled'
  const pi = PHASE_ORDER.indexOf(phase)
  const rows: { t: string; text: string; phase: Phase; accent?: boolean }[] = [
    { t: '00.0', text: `запрос: «${wave?.query ?? seed.query}»`, phase: 'query' },
    { t: '00.2', text: `кластер «${wave?.clusterLabel ?? seed.clusterLabel}» активирован`, phase: 'cluster' },
    { t: '00.5', text: `кандидатов: ${cands} → отсев`, phase: 'filter' },
    { t: '00.8', text: `цель: ${wave?.target ?? '—'}`, phase: 'found', accent: true },
  ]

  /* Короткая подпись состояния потока — для ambient-пилюли над картой. */
  const flowText =
    phase === 'query'
      ? `запрос: ${wave?.query ?? '…'}`
      : phase === 'cluster'
        ? `кластер «${wave?.clusterLabel ?? '—'}»`
        : phase === 'filter'
          ? `отсев · осталось ${cands}`
          : phase === 'found'
            ? `цель: ${wave?.target ?? '—'}`
            : phase === 'settled'
              ? `связь установлена · ${wave?.target ?? ''}`
              : 'поток спокоен · ждём следующую волну'

  /* Соседи выбранного узла — настоящие связи из графа, а не декорация. */
  const neighbors = useMemo(() => {
    if (!info || info.core || !info.id) return []
    return neighborsOf(graph, info.id, 5)
  }, [graph, info])

  const REASON: Record<string, string> = {
    pin: 'приколот',
    tag: 'метка',
    cluster: 'кластер',
  }

  const topClusters = useMemo(
    () => D.clusters.filter((c) => c.count > 0).sort((a, b) => b.count - a.count).slice(0, 4),
    [D.clusters],
  )

  const processingIds = useMemo(
    () => D.files.filter((f) => f.processing).map((f) => f.id),
    [D.files],
  )

  return (
    <div className="map-stage map-space" role="main" data-testid="screen-map">
      <div className="cosmos" aria-hidden="true">
        <i className="cos-deep" />
        <i className="cos-neb n1" />
        <i className="cos-neb n2" />
        <i className="cos-neb n3" />
        <i className="cos-way" />
        <i className="cos-stars s1" />
        <i className="cos-stars s2" />
        <i className="cos-stars s3" />
        <i className="cos-vig" />
      </div>
      <canvas id="net" ref={canvasRef} aria-label="Карта связей файлов и стикеров" />

      <div className="float-panel map-topleft">
        <div className="map-controls glass">
          <div className="map-zoom">
            <button
              className="icon-btn"
              onClick={() => call('zoomIn')}
              data-testid="map-zoom-in"
              title="Приблизить (+)"
              aria-label="Приблизить, горячая клавиша плюс"
            >
              <IconPlus />
            </button>
            <button
              className="icon-btn"
              onClick={() => call('zoomOut')}
              data-testid="map-zoom-out"
              title="Отдалить (−)"
              aria-label="Отдалить, горячая клавиша минус"
            >
              <IconMinus />
            </button>
            <button
              className="icon-btn"
              onClick={() => call('fit')}
              data-testid="map-zoom-fit"
              title="Вписать граф в экран (F)"
              aria-label="Вписать граф в экран, горячая клавиша F"
            >
              <IconTarget />
            </button>
            <button
              className="map-zoom-val mono num"
            data-testid="map-zoom-level"
              onClick={() => call('reset')}
              onDoubleClick={() => call('fit')}
              title="Клик — вернуть 100% (0) · двойной клик — вписать (F)"
              aria-label={`Масштаб ${zoom} процентов, клик возвращает сто процентов`}
            >
              {zoom}%
            </button>
          </div>
          <Dropdown
            label="Кластер на карте"
            variant="chip"
            className={`map-filter${cluster === 'all' ? '' : ' on'}`}
            value={cluster}
            options={clusterOptions}
            onChange={(val) => setCluster(val as ClusterId | 'all')}
            icon={IconLayers}
            menuWidth={276}
          />
        </div>

        {/* Поток активации идёт сам: пилюля только рассказывает, что происходит. */}
        <div
          className={`map-flow glass${playing ? ' live' : ''}`}
          role="status"
          aria-live="polite"
          data-testid="map-flow"
        >
          <i className="flow-dot" aria-hidden="true" />
          <span className="flow-text mono" data-testid="map-flow-text">
            {flowText}
          </span>
          <span className="flow-seq label-mono num" title="Волн активации за сеанс" data-testid="map-flow-seq">
            {wave?.seq ?? 0}
          </span>
        </div>

        {/* Чип живёт от состояния конвейера, а не от таймера на 7 секунд. */}
        {stats.processing > 0 && (
          <button
            className="map-status status-chip"
            data-testid="map-processing-chip"
            role="status"
            aria-live="polite"
            onClick={() => api.current?.focusIds(processingIds)}
            title="Показать файлы в обработке на карте"
          >
            <i className="net-dot" />
            ИИ анализирует {stats.processing}{' '}
            {stats.processing === 1 ? 'новый файл' : 'новых файлов'}
            <i className="chip-progress" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="float-panel map-footer glass">
        <div className="map-legend">
          <span className="lg">
            <i style={{ background: 'rgba(47,190,126,.95)' }} />
            ядро · {stats.links} связей
          </span>
          <span className="lg">
            <i style={{ background: 'rgba(107,118,137,.9)' }} />
            файлы · {stats.files}
          </span>
          <span className="lg">
            <i style={{ background: 'rgba(176,141,87,.9)' }} />
            стикеры · {stats.notes}
          </span>
        </div>
        <span className="lg-hint">
          волны идут сами · тяните карту · колесо — зум · клик по точке — карточка
        </span>
      </div>

      <aside
        className={`float-panel node-inspector glass${info?.found ? ' found' : ''}`}
        aria-label="Инспектор узла"
        data-testid="map-inspector"
      >
        {/* Узел найден поиском: луч по кромке подтверждает попадание. */}
        {info?.found ? <Beam duration={3.6} size={44} /> : null}
        <div className="ni-scroll">
          <div className="ni-head" ref={headRef} tabIndex={-1}>
          <span className="label-mono">Инспектор узла</span>
          <span className={`ni-live label-mono${playing ? ' on' : ''}`} title="Волны активации идут автоматически">
            <i aria-hidden="true" />
            {playing ? 'волна' : 'наблюдение'}
          </span>
          <button
            className="icon-btn ni-close"
            title="Закрыть (Esc)"
            aria-label="Закрыть инспектор"
            onClick={() => call('clear')}
          >
            <IconClose />
          </button>
        </div>

        {info ? (
          <>
            <div className="ni-file">
              <span className="ni-icon glass">
                {info.kind === 'note' ? <IconSticker /> : <IconDoc />}
              </span>
              <div className="ni-file-text">
                <div className="ni-title-row">
                  <h3 className="mono" data-testid="map-node-title">
                    {info.name}
                  </h3>
                  <span className="ni-badge mono">{info.typeLabel}</span>
                </div>
                <p>{info.meta}</p>
              </div>
            </div>
            <span className="ni-cluster">
              <i className="net-dot" style={{ background: `rgb(${info.hue})`, animation: 'none' }} />
              {info.cluster}
              {info.found && <b className="ni-found mono">найдено поиском</b>}
            </span>

            <div className="ni-metrics">
              <div className="ni-metric">
                <span className="ni-m-label">{info.core ? 'Магистралей' : 'Связей'}</span>
                <span className="ni-m-val mono num">{info.links}</span>
                <span className="ni-m-bar" aria-hidden="true">
                  <i
                    style={{
                      width: `${clampPct(info.links * 6)}%`,
                      background: `rgb(${info.hue})`,
                    }}
                  />
                </span>
              </div>
              <div className="ni-metric">
                <span className="ni-m-label">{info.powerLabel}</span>
                <span className="ni-m-val mono num">
                  {info.core ? `~${info.power}` : `${info.power}%`}
                  {info.core && <span className="ni-m-unit">/мин</span>}
                </span>
                <span className="ni-m-bar" aria-hidden="true">
                  <i
                    style={{ width: `${clampPct(info.power)}%`, background: `rgb(${info.hue})` }}
                  />
                </span>
              </div>
            </div>

            {/* Кнопки ведут в тот же сейф: библиотека откроет именно этот объект. */}
            <div className="ni-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (info.kind === 'file') NAV.openFile(info.id)
                  else NAV.go('library')
                }}
                disabled={info.core}
                data-testid="map-open-node"
              >
                Открыть
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => NAV.openCluster(info.clusterId ?? 'all')}
                data-testid="map-open-cluster"
              >
                Кластер
              </button>
            </div>

            {!info.core && neighbors.length > 0 && (
              <div className="ni-section">
                <span className="label-mono">
                  Связи узла · <b className="num">{info.links}</b>
                </span>
                <div className="ni-links">
                  {neighbors.map((nb) => (
                    <button
                      className="ni-link"
                      key={nb.node.id}
                      onClick={() => api.current?.select(nb.node.id)}
                      title={`Перейти к «${nb.node.label}»`}
                      data-testid={`map-neighbor-${nb.node.id}`}
                    >
                      <span className="ni-link-ico">
                        {nb.node.kind === 'note' ? <IconSticker /> : <IconDoc />}
                      </span>
                      <span className="ni-link-name ellipsis">{nb.node.label}</span>
                      <span className="ni-link-reason label-mono">{REASON[nb.reason]}</span>
                      <span className="ni-link-bar" aria-hidden="true">
                        <i style={{ width: `${clampPct(nb.w * 100)}%` }} />
                      </span>
                      <IconArrowRight className="ni-link-go" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {info.core && topClusters.length > 0 && (
              <div className="ni-section">
                <span className="label-mono">Магистрали к кластерам</span>
                <div className="ni-links">
                  {topClusters.map((c) => (
                    <button
                      className="ni-link"
                      key={c.id}
                      onClick={() => setCluster(c.id as ClusterId)}
                      title={`Показать кластер «${c.label}»`}
                      data-testid={`map-core-cluster-${c.id}`}
                    >
                      <span className="ni-link-ico">
                        <i className="cluster-dot" style={{ background: `rgba(${c.rgb},.9)` }} />
                      </span>
                      <span className="ni-link-name ellipsis">{c.label}</span>
                      <span
                        className="ni-link-reason label-mono num"
                        title={`${c.count} узлов · ${c.links} внутренних связей`}
                      >
                        {c.count}/{c.links}
                      </span>
                      <span className="ni-link-bar" aria-hidden="true">
                        <i style={{ width: `${clampPct((c.count / Math.max(1, stats.nodes)) * 260)}%` }} />
                      </span>
                      <IconArrowRight className="ni-link-go" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="ni-section">
              <span className="label-mono">
                Поток активации · <b className="ni-auto">авто</b>
              </span>
              <div className="wave-log wave-tl mono">
                {rows.map((r) => {
                  const idx = PHASE_ORDER.indexOf(r.phase)
                  const state = pi > idx ? ' done' : pi === idx ? ' on' : ''
                  return (
                    <div className={`step${state}${r.accent ? ' accent' : ''}`} key={r.t}>
                      <span className="t num">{r.t}</span>
                      <span className="wave-text ellipsis">{r.text}</span>
                    </div>
                  )
                })}
              </div>
              {history.length > 0 && (
                <div className="ni-trace">
                  <span className="label-mono">Найдено в этом сеансе</span>
                  {history.map((h) => (
                    <button
                      className="ni-trace-row"
                      key={h.at}
                      data-testid={`map-trace-${h.at}`}
                      onClick={() => {
                        const hit = graph.nodes.find((n) => n.label === h.name)
                        if (hit) api.current?.select(hit.id)
                      }}
                      title={`Показать «${h.name}»`}
                    >
                      <i aria-hidden="true" />
                      <span className="ellipsis">{h.name}</span>
                      <span className="label-mono">{h.cluster}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="ni-empty">
            <p>
              Узел не выбран — карта продолжает искать сама. В сейфе {stats.nodes} узлов и{' '}
              {stats.links} связей на {fmtBytes(stats.bytes)}: кликните точку, чтобы разобрать её
              связи, или просто наблюдайте за потоком.
            </p>
            <div className="ni-empty-flow mono">
              <i className={`flow-dot${playing ? ' on' : ''}`} aria-hidden="true" />
              {flowText}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => call('core')} data-testid="map-show-core">
              Показать ядро
            </button>
          </div>
        )}
        </div>
      </aside>
    </div>
  )
}

function clampPct(v: number) {
  return Math.max(4, Math.min(100, Math.round(v)))
}
