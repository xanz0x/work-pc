import { CLUSTERS, clusterIndex, fileTags, type ClusterId, type VaultFile } from './data'
import { isAlive, type Note } from './notes'

/* ============================================================
   СВЯЗИ
   «318 связей» в сайдбаре раньше были картинкой. Здесь они
   считаются: связь возникает между двумя объектами сейфа, если у
   них общий кластер, общая метка или стикер приколот к файлу.
   Карта памяти, библиотека и статус-бар читают одну и ту же
   таблицу, поэтому число связей везде совпадает.
   ============================================================ */

export type NodeKind = 'file' | 'note'

export type GNode = {
  id: string
  kind: NodeKind
  /** Индекс в массиве nodes: канвасу нужен именно он. */
  idx: number
  label: string
  meta: string
  cluster: ClusterId
  /** Позиция кластера на сетке карты (3×2). */
  ring: number
  tags: string[]
  /** 0..1 — вес объекта: у файлов по объёму, у стикеров по сроку жизни. */
  weight: number
  locked: boolean
  /** Стикер с таймером или файл в обработке — пунктирный контур на карте. */
  temp: boolean
  processing: boolean
  bytes: number
  pages?: number
  date: string
}

export type EdgeReason = 'pin' | 'tag' | 'cluster'

export type GEdge = {
  a: number
  b: number
  /** 0..1 — плотность линии на карте. */
  w: number
  /** Связь внутри кластера рисуется ярче, чем мост между кластерами. */
  same: boolean
  reason: EdgeReason
}

export type Graph = {
  nodes: GNode[]
  edges: GEdge[]
  /** Степень каждого узла по его индексу. */
  degree: number[]
  byId: Map<string, GNode>
  links: number
  /** Часть связей не построена из-за бюджета: интерфейс говорит «и ещё». */
  capped: boolean
}

/**
 * Бюджет связей на узел. Полный граф на большом корпусе даёт квадратичное
 * число рёбер: и карта нечитаема, и главный поток занят. Восемь — столько,
 * сколько инспектор узла всё равно показывает (neighborsOf: 6).
 */
export const MAX_DEGREE = 8

function shared(a: string[], b: string[]): number {
  let n = 0
  for (const t of a) if (b.includes(t)) n++
  return n
}

/** Кластер стикера — это кластер файла, к которому он приколот. */
function noteCluster(n: Note, files: VaultFile[]): ClusterId {
  if (n.pinnedTo) {
    const f = files.find((x) => x.id === n.pinnedTo)
    if (f) return f.cluster
  }
  return 'misc'
}

/**
 * Собирает граф сейфа. Порядок узлов детерминирован (сначала файлы, потом
 * живые стикеры), поэтому раскладка карты не «прыгает» между рендерами.
 */
export function buildGraph(files: VaultFile[], notes: Note[], now: number): Graph {
  const nodes: GNode[] = []
  const maxBytes = Math.max(1, ...files.map((f) => f.bytes))

  files.forEach((f) => {
    nodes.push({
      id: f.id,
      kind: 'file',
      idx: nodes.length,
      label: f.name,
      meta: f.desc,
      cluster: f.cluster,
      ring: clusterIndex(f.cluster),
      tags: fileTags(f),
      weight: Math.min(1, 0.25 + (f.bytes / maxBytes) * 0.75),
      locked: false,
      temp: false,
      processing: Boolean(f.processing),
      bytes: f.bytes,
      pages: f.pages,
      date: f.date,
    })
  })

  notes
    .filter((n) => isAlive(n, now))
    .forEach((n) => {
      const cluster = noteCluster(n, files)
      nodes.push({
        id: n.id,
        kind: 'note',
        idx: nodes.length,
        label: n.title,
        meta: n.body.slice(0, 96),
        cluster,
        ring: clusterIndex(cluster),
        tags: n.tags,
        weight: n.expiresAt === null ? 0.55 : 0.4,
        locked: n.locked,
        temp: n.expiresAt !== null,
        processing: false,
        bytes: n.body.length + n.title.length,
        date: '',
      })
    })

  const edges: GEdge[] = []
  const degree = new Array(nodes.length).fill(0)
  /** Ключи уже созданных связей: без него дедупликация была бы O(n²·E). */
  const seen = new Set<number>()
  const keyOf = (a: number, b: number) => (a < b ? a : b) * nodes.length + (a < b ? b : a)
  let capped = false

  function link(a: number, b: number, w: number, reason: EdgeReason) {
    const key = keyOf(a, b)
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ a, b, w, same: nodes[a].cluster === nodes[b].cluster, reason })
    degree[a]++
    degree[b]++
  }

  const noteStart = files.length

  // Стикер ↔ файл: самая крепкая связь, её пользователь создал руками.
  notes.forEach((n) => {
    const i = nodes.findIndex((x) => x.id === n.id)
    if (i < 0 || !n.pinnedTo) return
    const j = nodes.findIndex((x) => x.kind === 'file' && x.id === n.pinnedTo)
    if (j >= 0) link(i, j, 1, 'pin')
  })

  /* Всё остальное: общие метки крепче общего кластера.
     Бюджет связей на узел (MAX_DEGREE) — не «красота», а необходимость:
     на папке из 1 000 файлов полный граф даёт полмиллиона рёбер, карта
     превращается в кашу, а главный поток встаёт. Что не поместилось —
     помечается флагом `capped`, чтобы интерфейс не выдумывал полноту. */
  for (let i = 0; i < nodes.length; i++) {
    if (degree[i] >= MAX_DEGREE) continue
    for (let j = i + 1; j < nodes.length; j++) {
      if (degree[i] >= MAX_DEGREE) {
        capped = capped || j < nodes.length - 1
        break
      }
      if (degree[j] >= MAX_DEGREE) {
        capped = true
        continue
      }
      if (seen.has(keyOf(i, j))) continue
      const s = shared(nodes[i].tags, nodes[j].tags)
      const same = nodes[i].cluster === nodes[j].cluster
      if (s > 0) link(i, j, Math.min(1, 0.5 + s * 0.2), 'tag')
      else if (same && (i < noteStart) === (j < noteStart)) link(i, j, 0.34, 'cluster')
    }
  }

  return {
    nodes,
    edges,
    degree,
    byId: new Map(nodes.map((n) => [n.id, n])),
    links: edges.length,
    capped,
  }
}

/** Сколько объектов и связей приходится на кластер — легенда карты. */
export function clusterLoad(g: Graph) {
  return CLUSTERS.map((c, ring) => {
    const own = g.nodes.filter((n) => n.cluster === c.id)
    const inner = g.edges.filter(
      (e) => g.nodes[e.a].cluster === c.id && g.nodes[e.b].cluster === c.id,
    ).length
    return { ...c, ring, count: own.length, links: inner }
  })
}

/** Соседи узла по убыванию силы связи — используется инспектором карты. */
export function neighborsOf(g: Graph, id: string, limit = 6) {
  const self = g.byId.get(id)
  if (!self) return []
  return g.edges
    .filter((e) => e.a === self.idx || e.b === self.idx)
    .map((e) => ({ node: g.nodes[e.a === self.idx ? e.b : e.a], w: e.w, reason: e.reason }))
    .sort((x, y) => y.w - x.w)
    .slice(0, limit)
}
