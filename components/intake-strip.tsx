'use client'

/* ============================================================
   ПРИЁМ ФАЙЛОВ · ЖИВАЯ ПОЛОСА СОСТОЯНИЯ
   Что именно происходит с каждым добавленным файлом: уехал в папку
   хранения → читает ИИ → получил название, описание и метки.
   Никаких выдуманных процентов: полоса считает разобранные файлы.
   ============================================================ */

import './intake-strip.css'
import { IconAlertTri, IconCheck, IconClose, IconDoc } from './icons'
import type { IntakeTrack } from '@/lib/intake'

const LABEL: Record<IntakeTrack['state'], string> = {
  upload: 'Переносим в папку хранения…',
  analyzing: 'ИИ читает файл…',
  done: 'Разобран',
  partial: 'Разобран частично',
  failed: 'Не удалось',
}

const BADGE: Record<IntakeTrack['state'], string> = {
  upload: 'перенос',
  analyzing: 'разбор',
  done: 'готово',
  partial: 'частично',
  failed: 'ошибка',
}

export function IntakeStrip({ tracks, onClose }: { tracks: IntakeTrack[]; onClose: () => void }) {
  if (tracks.length === 0) return null
  const busy = tracks.some((t) => t.state === 'upload' || t.state === 'analyzing')
  const settled = tracks.filter((t) => t.state !== 'upload' && t.state !== 'analyzing').length
  const failed = tracks.filter((t) => t.state === 'failed').length
  return (
    <div className="ik-strip" data-testid="intake-strip" data-busy={busy ? '1' : undefined}>
      <div className="ik-head">
        <span className="ik-title label-mono">Приём файлов</span>
        <span className="ik-count mono" data-testid="intake-count">
          {settled}/{tracks.length}
        </span>
        <span className="grow" />
        <span className="ik-state label-mono" data-testid="intake-state">
          {busy ? 'в работе' : failed ? `ошибок: ${failed}` : 'завершено'}
        </span>
        {!busy && (
          <button type="button" className="ik-x" onClick={onClose} aria-label="Скрыть" data-testid="intake-close">
            <IconClose width={11} height={11} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="ik-bar" role="progressbar" aria-valuemin={0} aria-valuemax={tracks.length} aria-valuenow={settled}>
        <i style={{ width: `${Math.round((settled / tracks.length) * 100)}%` }} />
      </div>
      <ul>
        {tracks.map((t, i) => (
          <li key={`${t.name}-${i}`} data-state={t.state} data-testid="intake-row">
            <span className={`ik-ico${t.state === 'upload' || t.state === 'analyzing' ? ' spin' : ''}`} aria-hidden="true">
              {t.state === 'done' || t.state === 'partial' ? (
                <IconCheck />
              ) : t.state === 'failed' ? (
                <IconAlertTri />
              ) : (
                <IconDoc />
              )}
            </span>
            <span className="ik-text">
              <b className="ellipsis" title={t.title || t.name}>
                {t.title || t.name}
              </b>
              <span className="ik-sub">
                {t.state === 'done' || t.state === 'partial'
                  ? t.description || LABEL[t.state]
                  : t.error || LABEL[t.state]}
              </span>
              {t.tags && t.tags.length > 0 && (
                <span className="ik-tags">
                  {t.tags.map((tag) => (
                    <i key={tag}>{tag}</i>
                  ))}
                </span>
              )}
            </span>
            <span className="ik-badge mono">{BADGE[t.state]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
