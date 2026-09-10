'use client'

/* Полоса подпапок Библиотеки: крошки пути и настоящие папки текущего уровня
   внутри выбранной личной папки на ПК. Вынесено из screen-library.tsx. */

import './library-dirs.css'
import { IconFolder } from './icons'

export function LibraryDirStrip({
  root,
  dir,
  subDirs,
  onDir,
}: {
  /** Абсолютный путь личной папки — в подсказке к «Моей папке». */
  root: string
  /** Открытая подпапка ('' — корень папки хранения). */
  dir: string
  /** Подпапки текущего уровня, пути через «/». */
  subDirs: string[]
  onDir: (next: string) => void
}) {
  return (
    <div className="lib-dirs panel" data-testid="lib-dirs">
      <div className="lib-dirs-crumbs" data-testid="lib-dirs-crumbs">
        <button
          className={`f-chip${dir === '' ? ' on' : ''}`}
          onClick={() => onDir('')}
          title={root}
          data-testid="lib-dir-root"
        >
          <IconFolder width={12} height={12} aria-hidden="true" /> Моя папка
        </button>
        {(dir ? dir.split('/') : []).map((c, i, arr) => {
          const p = arr.slice(0, i + 1).join('/')
          return (
            <button
              key={p}
              className={`f-chip${dir === p ? ' on' : ''}`}
              onClick={() => onDir(p)}
              data-testid="lib-dir-crumb"
            >
              / {c}
            </button>
          )
        })}
      </div>
      {subDirs.length > 0 && (
        <div className="lib-dirs-list">
          {subDirs.map((f) => (
            <button key={f} className="f-chip" onClick={() => onDir(f)} data-testid="lib-dir-open">
              <IconFolder width={12} height={12} aria-hidden="true" /> {f.split('/').slice(-1)[0]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
