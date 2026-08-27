import type { ComponentType, SVGProps } from 'react'

/**
 * Канонический набор иконок каркаса WorkfloW.
 * Все пути взяты 1:1 из исходных прототипов «Графит» v3.
 * Размеры и цвет задаёт CSS через currentColor / stroke.
 */

type P = SVGProps<SVGSVGElement>

const base = { viewBox: '0 0 24 24', fill: 'none' as const }

export function IconLibrary(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

export function IconGraph(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="5" cy="6" r="1.8" />
      <circle cx="19" cy="7" r="1.8" />
      <circle cx="5.5" cy="18" r="1.8" />
      <circle cx="18.5" cy="17.5" r="1.8" />
      <path d="M6.5 7.2 10 10.4M17.5 7.8 14 10.4M6.7 16.8 10.3 13.8M16.9 16.3 13.7 13.7" />
    </svg>
  )
}

export function IconChat(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.4-2.4A8 8 0 1 1 21 12z" />
    </svg>
  )
}

export function IconGear(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function IconBell(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

export function IconSearch(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function IconChevronLeft(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

export function IconPlus(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconMinus(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconTarget(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  )
}

export function IconChevronDown(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function IconClose(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export function IconPlay(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="m6 4 14 8-14 8V4z" />
    </svg>
  )
}

export function IconDoc(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

export function IconDocLines(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  )
}

export function IconDocCheck(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  )
}

export function IconSheet(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  )
}

export function IconSheetSmall(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18" />
    </svg>
  )
}

export function IconImage(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  )
}

export function IconMusic(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

export function IconPresentation(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  )
}

export function IconPencil(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  )
}

export function IconLock(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="4" y="11" width="16" height="10" rx="1" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function IconLockRound(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function IconExternal(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  )
}

export function IconDocPreview(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  )
}

export function IconNode(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="5" cy="6" r="1.9" />
      <circle cx="19" cy="7" r="1.9" />
      <circle cx="16.5" cy="18.5" r="1.9" />
      <path d="M6.6 7.3l3.8 3.2M17.4 8.3l-3.6 2.5M15.2 17.2l-2.4-3" />
    </svg>
  )
}

export function IconTrash(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function IconClip(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

export function IconScreenshot(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  )
}

export function IconSend(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

export function IconSpreadsheetFin(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h3M8.5 16.5h3M14.5 13h1M14.5 16.5h1" />
    </svg>
  )
}

export function IconDocDraft(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 12h6M9 15h6M9 18h3" />
    </svg>
  )
}

export function IconChipAi(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  )
}

export function IconPipeline(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="9" width="5" height="6" rx="1.5" />
      <rect x="16" y="9" width="5" height="6" rx="1.5" />
      <path d="M8 12h3m2 0h3" />
    </svg>
  )
}

export function IconDatabase(p: P) {
  return (
    <svg {...base} {...p}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  )
}

export function IconShield(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
      <path d="m9 11.5 2 2 4-4" />
    </svg>
  )
}

export function IconRefresh(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

export function IconInbox(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3v10m0 0 4-4m-4 4L8 9" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export function IconSparkText(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M4 6h16M4 11h10M4 16h7" />
      <path d="m18 14 .9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
    </svg>
  )
}

export function IconFolder(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

export function IconTag(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  )
}

export function IconMemory(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="5" cy="6" r="1.6" />
      <circle cx="19" cy="6" r="1.6" />
      <circle cx="5" cy="18" r="1.6" />
      <circle cx="19" cy="18" r="1.6" />
      <path d="M6.4 7.2 10.2 10.5M17.6 7.2 13.8 10.5M6.4 16.8 10.2 13.5M17.6 16.8 13.8 13.5" />
    </svg>
  )
}

export function IconArrowRight(p: P) {
  return (
    <svg viewBox="0 0 20 12" fill="none" {...p}>
      <path d="M1 6h15m-4-4 4 4-4 4" />
    </svg>
  )
}

export function IconCheck(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  )
}

export function IconSort(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M7 4.5v15m0 0-3.2-3.4M7 19.5l3.2-3.4M17 19.5v-15m0 0-3.2 3.4M17 4.5l3.2 3.4" />
    </svg>
  )
}

export function IconLayers(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5z" />
      <path d="M3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </svg>
  )
}

export function IconUser(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.8 20c1.3-3.6 3.9-5.4 7.2-5.4s5.9 1.8 7.2 5.4" />
    </svg>
  )
}

export function IconClock(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </svg>
  )
}

export function IconSticker(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M4.5 4.5h10.2L19.5 9.3v10.2h-15V4.5z" />
      <path d="M14.7 4.5v4.8h4.8" />
    </svg>
  )
}

export function IconPin(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M12 13.5V21" />
      <path d="M7 3.5h10l-1.4 4.2 2.4 3.1v2.7H6l0-2.7 2.4-3.1L7 3.5z" />
    </svg>
  )
}

export function IconKey(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="8" cy="15.8" r="3.7" />
      <path d="M10.7 13.2 19 5m-2.6 0H20v3.6" />
    </svg>
  )
}

/* ---------- Доска библиотеки ---------- */

/** Ручка переноса: шесть точек захвата. */
export function IconGrip(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="9" cy="6" r="0.9" />
      <circle cx="15" cy="6" r="0.9" />
      <circle cx="9" cy="12" r="0.9" />
      <circle cx="15" cy="12" r="0.9" />
      <circle cx="9" cy="18" r="0.9" />
      <circle cx="15" cy="18" r="0.9" />
    </svg>
  )
}

/** Смена размера плитки: две расходящиеся диагональные стрелки. */
export function IconResize(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M13.5 4H20v6.5" />
      <path d="m20 4-7 7" />
      <path d="M10.5 20H4v-6.5" />
      <path d="m4 20 7-7" />
    </svg>
  )
}

/** Закрепить наверх: канцелярская кнопка остриём вниз. */
export function IconPinTop(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M12 9.5V21" />
      <path d="m8.2 4.5 3.8-1.8 3.8 1.8-1.2 5H9.4l-1.2-5z" />
    </svg>
  )
}

/** Плотность доски: крупная плитка и две малые. */
export function IconGridBoard(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M10.7 4v16" />
      <path d="M10.7 10.7H20" />
    </svg>
  )
}

/**
 * Знак WorkfloW: волосяная рамка сейфа, внутри — литера «W»,
 * собранная как граф из пяти узлов и четырёх связей. Центральный
 * узел акцентный: это точка, в которой ИИ смыкает смыслы.
 */
export function IconLogoMark(p: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <rect className="lm-frame" x="2.25" y="2.25" width="19.5" height="19.5" rx="1" />
      <path className="lm-edge" d="M6.4 8.2 9.6 15.4 12 10.6 14.4 15.4 17.6 8.2" />
      <circle className="lm-node" cx="6.4" cy="8.2" r="1.25" />
      <circle className="lm-node" cx="9.6" cy="15.4" r="1.25" />
      <circle className="lm-node" cx="14.4" cy="15.4" r="1.25" />
      <circle className="lm-node" cx="17.6" cy="8.2" r="1.25" />
      <circle className="lm-core" cx="12" cy="10.6" r="1.7" />
    </svg>
  )
}

/* ============================================================
   РЕЕСТР ИКОНОК
   Сейф живёт в localStorage, а React-компонент туда не положишь.
   Поэтому файлы, стикеры и события конвейера хранят строковый id
   иконки, а сам компонент разрешается здесь, при отрисовке. Это
   единственное место, где id превращается в графику: любой экран
   получает одну и ту же иконку для одной и той же сущности.
   ============================================================ */

export type IconId =
  | 'doc'
  | 'docCheck'
  | 'docDraft'
  | 'docLines'
  | 'sheet'
  | 'sheetSmall'
  | 'spreadsheetFin'
  | 'image'
  | 'music'
  | 'presentation'
  | 'sticker'
  | 'shield'
  | 'tag'
  | 'check'
  | 'inbox'
  | 'chipAi'
  | 'lockRound'
  | 'graph'
  | 'clock'
  | 'trash'
  | 'memory'
  | 'sparkText'
  | 'refresh'
  | 'folder'

export const ICONS: Record<IconId, ComponentType<P>> = {
  doc: IconDoc,
  docCheck: IconDocCheck,
  docDraft: IconDocDraft,
  docLines: IconDocLines,
  sheet: IconSheet,
  sheetSmall: IconSheetSmall,
  spreadsheetFin: IconSpreadsheetFin,
  image: IconImage,
  music: IconMusic,
  presentation: IconPresentation,
  sticker: IconSticker,
  shield: IconShield,
  tag: IconTag,
  check: IconCheck,
  inbox: IconInbox,
  chipAi: IconChipAi,
  lockRound: IconLockRound,
  graph: IconGraph,
  clock: IconClock,
  trash: IconTrash,
  memory: IconMemory,
  sparkText: IconSparkText,
  refresh: IconRefresh,
  folder: IconFolder,
}

/** Иконка по id с безопасным запасным вариантом. */
export function iconOf(id: IconId | undefined): ComponentType<P> {
  return (id && ICONS[id]) || IconDoc
}
