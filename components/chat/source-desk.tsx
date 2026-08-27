'use client'

import { useEffect, useRef } from 'react'
import { IconClose, IconGraph, IconTarget, IconDocPreview, IconLock } from '../icons'
import { useVault } from '@/lib/vault-store'
import { useRedacted } from '@/lib/redact-context'
import type { ChatSource } from './types'

/**
 * Стол источника: правая колонка, где лежит доказательство ответа — цитата,
 * место в файле и вес совпадения. Открывается по сноске и закрывается Esc:
 * проверка ответа не должна уводить со страницы разговора.
 */
export function SourceDesk({
  sources,
  activeN,
  onPick,
  onClose,
  onOpenMap,
  onOpenFile,
  onPin,
  pinned,
}: {
  sources: ChatSource[]
  activeN: number | null
  onPick: (n: number) => void
  onClose: () => void
  onOpenMap: (fileId: string) => void
  onOpenFile: (fileId: string) => void
  onPin: (fileId: string) => void
  pinned: string[]
}) {
  const { viewById } = useVault()
  const { redactIds } = useRedacted()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Показываем только те источники, чьи файлы всё ещё лежат в сейфе. */
  const live = sources.filter((s) => Boolean(viewById(s.fileId)))
  const asked = sources.find((s) => s.n === activeN)
  /** Спросили именно про удалённый источник — не подменяем его соседним. */
  const gone = Boolean(asked) && !viewById(asked!.fileId)
  const active = gone ? undefined : (live.find((s) => s.n === activeN) ?? live[0])
  const file = active ? viewById(active.fileId) : undefined

  if (!active || !file) {
    return (
      <aside className="desk" aria-label="Источник ответа">
        <header className="desk-head">
          <span className="label-mono">источник удалён</span>
          <span className="grow" />
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            ref={closeRef}
            aria-label="Закрыть панель источника"
          >
            <IconClose aria-hidden="true" />
          </button>
        </header>
        <p className="desk-note">
          <IconLock aria-hidden="true" />
          Файл этого источника удалён из сейфа, поэтому цитату нельзя проверить.
        </p>
      </aside>
    )
  }

  const Icon = file.Icon
  const isPinned = pinned.includes(file.id)
  /** п.10.3: под файловым ключом — только имя, не совпадение и не цитата. */
  const locked = Boolean(file && redactIds.has(file.id))

  return (
    <aside className="desk" aria-label="Источник ответа">
      <header className="desk-head">
        <span className="label-mono">источник {active.n}</span>
        <span className="grow" />
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          ref={closeRef}
          aria-label="Закрыть панель источника"
        >
          <IconClose aria-hidden="true" />
        </button>
      </header>

      {live.length > 1 ? (
        <div className="desk-tabs" role="tablist" aria-label="Источники этого ответа">
          {live.map((s) => (
            <button
              key={s.n}
              type="button"
              role="tab"
              aria-selected={s.n === active.n}
              className={`f-chip${s.n === active.n ? ' is-on' : ''}`}
              onClick={() => onPick(s.n)}
            >
              {s.n}
            </button>
          ))}
        </div>
      ) : null}

      <div className="desk-file">
        <span className="desk-ico" aria-hidden="true">
          <Icon />
        </span>
        <div className="desk-file-text">
          <p className="desk-name">{file.name}</p>
          <p className="desk-meta mono">
            {file.cat} · {file.meta}
          </p>
        </div>
      </div>

      {locked ? (
        <div className="desk-block">
          <p className="label-mono">содержимое</p>
          <div className="desk-note trace-redacted">
            <IconLock aria-hidden="true" />
            Источник под ключом — откройте файл
          </div>
        </div>
      ) : (
        <>
          <div className="desk-block">
            <p className="label-mono">совпадение</p>
            <div className="desk-weight">
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${active.weight}%` }} />
              </div>
              <span className="mono">{active.weight}%</span>
            </div>
          </div>

          <div className="desk-block">
            <p className="label-mono">{active.locator ?? 'фрагмент'}</p>
            <blockquote className="desk-quote">{active.quote}</blockquote>
          </div>
        </>
      )}

      <div className="desk-acts">
        <button
          type="button"
          className="btn btn-tertiary btn-sm btn-full"
          onClick={() => onOpenFile(file.id)}
        >
          <IconDocPreview aria-hidden="true" />
          Открыть файл
        </button>
        <button
          type="button"
          className="btn btn-tertiary btn-sm btn-full"
          onClick={() => onOpenMap(file.id)}
        >
          <IconGraph aria-hidden="true" />
          Показать на карте
        </button>
        {locked ? null : (
          <button
            type="button"
            className={`btn btn-sm btn-full ${isPinned ? 'btn-ghost' : 'btn-tertiary'}`}
            onClick={() => onPin(file.id)}
            aria-pressed={isPinned}
          >
            <IconTarget aria-hidden="true" />
            {isPinned ? 'Закреплён в контексте' : 'Закрепить в контексте'}
          </button>
        )}
      </div>

      <p className="desk-note">
        <IconLock aria-hidden="true" />
        Цитата прочитана с диска. Файл не покидал устройство.
      </p>
    </aside>
  )
}
