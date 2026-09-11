'use client'

/* ============================================================
   БИБЛИОТЕКА · ТУЛБАР
   Слой (Всё/Файлы/Стикеры), фильтры по тегам или кластерам,
   мультивыделение, плотность доски и сброс раскладки.
   Вынесено из screen-library.tsx без изменения поведения.
   ============================================================ */

import { IconCheck, IconGridBoard, IconRefresh } from './icons'
import { DENSITY_LABEL, type Density } from '@/lib/board-layout'
import type { ClusterId } from '@/lib/data'

type Layer = 'all' | 'files' | 'notes'
type CatId = ClusterId | 'all'

const LAYERS = [
  { v: 'all', l: 'Всё' },
  { v: 'files', l: 'Файлы' },
  { v: 'notes', l: 'Стикеры' },
] as const

export function LibraryToolbar({
  view,
  onLayer,
  tags,
  tag,
  onTag,
  cats,
  cat,
  onCat,
  boardDragActive,
  selectMode,
  onSelectMode,
  density,
  onDensity,
  canResetBoard,
  onResetBoard,
}: {
  view: Layer
  onLayer: (next: Layer) => void
  tags: { label: string; count: number }[]
  tag: string
  onTag: (label: string) => void
  cats: { id: CatId; label: string; count: number }[]
  cat: CatId
  onCat: (id: CatId) => void
  /** Плитку тащат: кластеры подсвечиваются как цели. */
  boardDragActive: boolean
  selectMode: boolean
  onSelectMode: () => void
  density: Density
  onDensity: () => void
  /** Раскладка доски своя — можно вернуть сортировку по умолчанию. */
  canResetBoard: boolean
  onResetBoard: () => void
}) {
  return (
    <div className="lib-toolbar">
      <div className="seg" role="group" aria-label="Слой библиотеки">
        {LAYERS.map((s) => (
          <button
            key={s.v}
            className={`seg-btn${view === s.v ? ' on' : ''}`}
            onClick={() => onLayer(s.v)}
            aria-pressed={view === s.v}
          >
            {s.l}
          </button>
        ))}
      </div>
      {view === 'notes' ? (
        <div className="filters" role="group" aria-label="Теги стикеров">
          {tags.map((f) => (
            <button
              key={f.label}
              className={`f-chip${tag === f.label ? ' on' : ''}`}
              onClick={() => onTag(f.label)}
              aria-pressed={tag === f.label}
            >
              {f.label} <b className="num">{f.count}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="filters" role="group" aria-label="Кластеры файлов">
          {cats.map((f) => (
            <button
              key={f.id}
              className={`f-chip${cat === f.id ? ' on' : ''}${
                boardDragActive && f.id !== 'all' ? ' drop-target' : ''
              }`}
              onClick={() => onCat(f.id)}
              aria-pressed={cat === f.id}
              /* Цель для файла, брошенного на кластер. */
              data-drop-cluster={f.id === 'all' ? undefined : f.id}
            >
              {f.label} <b className="num">{f.count}</b>
            </button>
          ))}
        </div>
      )}
      <span className="grow" />
      <button
        className={`btn btn-ghost btn-sm${selectMode ? ' on' : ''}`}
        onClick={onSelectMode}
        aria-pressed={selectMode}
        title="Мультивыделение: Ctrl/Cmd+клик добавляет карточку, Shift+клик берёт диапазон"
        data-testid="lib-select-mode"
      >
        <IconCheck />
        {selectMode ? 'Выбор включён' : 'Выделение'}
      </button>
      <button
        className={`btn btn-ghost btn-sm${density === 'compact' ? ' on' : ''}`}
        onClick={onDensity}
        aria-pressed={density === 'compact'}
        aria-label={`Плотность доски: ${DENSITY_LABEL[density]}`}
        title={`Плотность: ${DENSITY_LABEL[density]}`}
      >
        <IconGridBoard />
        {density === 'compact' ? 'Плотно' : 'Свободно'}
      </button>
      {canResetBoard && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={onResetBoard}
          aria-label="Сбросить раскладку этой доски"
          title="Сбросить раскладку"
        >
          <IconRefresh />
          Сбросить раскладку
        </button>
      )}
    </div>
  )
}
