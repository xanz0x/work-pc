'use client'

/* ============================================================
   ЖУРНАЛ БЕЗОПАСНОСТИ · панель в настройках (LG-3)
   Только чтение: кнопок «очистить» и «удалить запись» здесь нет и не
   будет — в этом весь смысл журнала. Фильтр по типу, экспорт в файл,
   подсветка записи, на которую привело уведомление.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { download } from '@/lib/secrets-io'
import {
  JOURNAL_KINDS,
  isSevereKind,
  journalKindLabel,
  journalToFile,
  readJournal,
  subscribeJournal,
  type JournalEntry,
  type JournalKind,
} from '@/lib/journal'
import { useNavStore, useToast } from '@/lib/vault-store'
import { IconLayers, IconShield } from './icons'

const fmtAt = (at: number) =>
  new Date(at).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

export function JournalPanel() {
  const { settingFocus } = useNavStore()
  const { flash } = useToast()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [filter, setFilter] = useState<JournalKind | 'all' | 'severe'>('all')
  const rowsRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(() => {
    void readJournal().then(setEntries)
  }, [])

  useEffect(() => {
    reload()
    return subscribeJournal(reload)
  }, [reload])

  /* Уведомление привело к конкретной записи: settingFocus = `journal:<id>`. */
  const focusId = settingFocus?.id.startsWith('journal:') ? settingFocus.id.slice(8) : null

  useEffect(() => {
    if (!focusId) return
    setFilter('all')
    const el = rowsRef.current?.querySelector(`[data-journal-id="${focusId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusId, entries])

  /* В фильтре показываем только те типы, что реально случались. */
  const present = useMemo(() => {
    const seen = new Set(entries.map((e) => e.kind))
    return JOURNAL_KINDS.filter((k) => seen.has(k.id))
  }, [entries])

  const severeCount = useMemo(() => entries.filter((e) => isSevereKind(e.kind)).length, [entries])

  const shown = useMemo(() => {
    if (filter === 'all') return entries
    if (filter === 'severe') return entries.filter((e) => isSevereKind(e.kind))
    return entries.filter((e) => e.kind === filter)
  }, [entries, filter])

  function exportAll() {
    const file = journalToFile(entries)
    download(file.name, file.text, 'application/json')
    flash(`Журнал выгружен: ${entries.length} записей. Сами записи остались в базе.`)
  }

  return (
    <section className="sec panel" id="set-journal" data-testid="journal-section">
      <div className="sec-head">
        <span className="sec-icon">
          <IconLayers />
        </span>
        <div className="sec-head-text">
          <div className="setting-title">Журнал безопасности</div>
          <div className="setting-note">
            Смена мастер-ключа, сброс замка, экспорт без шифрования, стирание сейфа и каждый
            исходящий запрос — только добавление, без правок и очистки
          </div>
        </div>
        <span className="sec-meta label-mono" data-testid="journal-count">
          {entries.length} записей
        </span>
      </div>

      <div className="jr-bar">
        <div className="jr-filters" role="group" aria-label="Фильтр журнала по типу">
          <button
            className="jr-chip"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
            data-testid="journal-filter-all"
          >
            Все
          </button>
          {severeCount > 0 && (
            <button
              className="jr-chip severe"
              aria-pressed={filter === 'severe'}
              onClick={() => setFilter('severe')}
              data-testid="journal-filter-severe"
            >
              Только необратимое · {severeCount}
            </button>
          )}
          {present.map((k) => (
            <button
              key={k.id}
              className={`jr-chip${k.severe ? ' severe' : ''}`}
              aria-pressed={filter === k.id}
              onClick={() => setFilter(k.id)}
              data-testid={`journal-filter-${k.id}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button
          className="btn"
          onClick={exportAll}
          disabled={entries.length === 0}
          data-testid="journal-export"
        >
          Выгрузить журнал
        </button>
      </div>

      <div className="jr-rows" ref={rowsRef} data-testid="journal-rows">
        {shown.length === 0 ? (
          <p className="jr-empty" data-testid="journal-empty">
            {entries.length === 0
              ? 'Пока ничего критического не происходило — журнал пуст.'
              : filter === 'severe'
                ? 'Необратимых событий не было.'
                : 'Нет записей этого типа.'}
          </p>
        ) : (
          shown.map((e) => (
            <div
              key={e.id}
              className={`jr-row${focusId === e.id ? ' focused' : ''}`}
              data-journal-id={e.id}
              data-kind={e.kind}
              data-testid="journal-row"
            >
              <span className="jr-time num">{fmtAt(e.at)}</span>
              <span className="jr-kind label-mono">
                {journalKindLabel(e.kind)}
                {isSevereKind(e.kind) && (
                  <i className="jr-flag" data-testid="journal-severe-flag">
                    необратимо
                  </i>
                )}
              </span>
              <span className="jr-text">
                <b>{e.title}</b>
                <span>{e.detail}</span>
              </span>
            </div>
          ))
        )}
      </div>

      <p className="jr-note">
        <IconShield width={13} height={13} /> Журнал живёт в отдельном сторе локальной базы:
        очистка ленты уведомлений, retention и стирание сейфа его не затрагивают. Значения паролей
        и содержимое файлов в записи не попадают.
      </p>
    </section>
  )
}
