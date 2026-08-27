'use client'

import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react'
import { useVault } from '@/lib/vault-store'
import { SCOPES } from '@/lib/search'
import type { Hit, HitKind } from '@/lib/search'
import {
  IconChat,
  IconDoc,
  IconGear,
  IconLayers,
  IconSearch,
  IconSticker,
} from './icons'

type Ico = ComponentType<SVGProps<SVGSVGElement>>

/** Иконка результата по его виду — палитра и топбар зовут одну и ту же. */
const HIT_ICON: Record<HitKind, Ico> = {
  file: IconDoc,
  note: IconSticker,
  chat: IconChat,
  cluster: IconLayers,
  setting: IconGear,
}

const KIND_LABEL: Record<HitKind, string> = {
  file: 'Файл',
  note: 'Стикер',
  chat: 'Разговор',
  cluster: 'Кластер',
  setting: 'Настройки',
}

/**
 * Ctrl/Cmd+K — единое окно поиска по всему сейфу. Строку запроса, область и
 * результаты оно берёт из того же store, что и топбар: набранное в палитре
 * видно в шапке и наоборот, «найдено N» всегда одно и то же N.
 */
export function CommandPalette() {
  const v = useVault()
  const inputRef = useRef<HTMLInputElement>(null)
  const [cursor, setCursor] = useState(0)

  // При каждом открытии — фокус в поле и сброс курсора на первый результат.
  useEffect(() => {
    if (v.palette) {
      setCursor(0)
      const t = setTimeout(() => inputRef.current?.focus(), 20)
      return () => clearTimeout(t)
    }
  }, [v.palette])

  // Новый запрос — снова целимся в самый релевантный результат.
  useEffect(() => setCursor(0), [v.query, v.scope])

  if (!v.palette) return null

  const hits = v.hits.slice(0, 20)

  function close() {
    v.setPalette(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(hits.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[cursor]
      if (hit) v.runHit(hit)
    }
  }

  return (
    <div className="cmdk-backdrop" onPointerDown={close} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Поиск по сейфу"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="cmdk-field">
          <IconSearch width={16} height={16} stroke="currentColor" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            className="cmdk-input"
            placeholder="Поиск по файлам, стикерам, разговорам и настройкам…"
            value={v.query}
            onChange={(e) => v.setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Поисковый запрос"
          />
          <kbd>ESC</kbd>
        </div>

        <div className="cmdk-scopes" role="tablist" aria-label="Область поиска">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              role="tab"
              aria-selected={v.scope === s.value}
              className={`cmdk-scope${v.scope === s.value ? ' on' : ''}`}
              onClick={() => v.setScope(s.value)}
              title={s.note}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="cmdk-results" role="listbox" aria-label="Результаты">
          {v.query.trim() === '' ? (
            <p className="cmdk-empty">
              Введите запрос. Смысловой поиск найдёт «где деньги» в бюджете и смете,
              а «домофон» — в стикере с ключом.
            </p>
          ) : hits.length === 0 ? (
            <p className="cmdk-empty">По запросу «{v.query}» ничего не найдено.</p>
          ) : (
            hits.map((hit, i) => (
              <PaletteRow
                key={hit.key}
                hit={hit}
                active={i === cursor}
                onRun={() => v.runHit(hit)}
                onHover={() => setCursor(i)}
              />
            ))
          )}
        </div>

        {v.query.trim() !== '' && hits.length > 0 && (
          <div className="cmdk-foot label-mono">
            <span>
              Найдено {hits.length}
              {v.hits.length > hits.length ? ` из ${v.hits.length}` : ''}
            </span>
            <span className="grow" />
            <span>↑↓ выбрать · ↵ открыть · Esc закрыть</span>
          </div>
        )}
      </div>
    </div>
  )
}

function PaletteRow({
  hit,
  active,
  onRun,
  onHover,
}: {
  hit: Hit
  active: boolean
  onRun: () => void
  onHover: () => void
}) {
  const Icon = HIT_ICON[hit.kind]
  const redacted = hit.kind === 'file' && hit.locked === true
  return (
    <button
      role="option"
      aria-selected={active}
      className={`cmdk-row${active ? ' cursor' : ''}${redacted ? ' is-locked' : ''}`}
      onClick={onRun}
      onMouseEnter={onHover}
    >
      <span className="cmdk-icon">
        <Icon />
      </span>
      <span className="cmdk-text">
        <span className="cmdk-title ellipsis">{hit.title}</span>
        <span className="cmdk-sub ellipsis">{redacted ? 'Под ключом' : hit.sub}</span>
      </span>
      {redacted ? (
        <span className="cmdk-badge is-lockflag">под ключом</span>
      ) : (
        hit.fuzzy && <span className="cmdk-badge">по смыслу</span>
      )}
      <span className="cmdk-kind label-mono">{KIND_LABEL[hit.kind]}</span>
    </button>
  )
}
