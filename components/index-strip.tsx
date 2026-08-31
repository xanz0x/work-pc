'use client'

/* ============================================================
   ПОЛОСА ИНДЕКСАТОРА (NF-1)
   Единственное место, где продукт рассказывает про индексацию, и
   единственный подписчик частого прогресса: библиотека с тысячей
   карточек не имеет права перерисовываться на каждый файл.
   ============================================================ */

import { IconCheck, IconClose, IconRefresh, IconShield } from './icons'
import { useIndexActions, useIndexProgress, useIndexSummary } from '@/lib/indexer/context'

const PHASE_LABEL: Record<string, string> = {
  scan: 'Обход папки',
  index: 'Чтение и разбор',
  done: 'Индекс готов',
  cancelled: 'Индексация отменена',
  error: 'Индексация прервана',
}

export function IndexStrip() {
  const { progress: p, where } = useIndexProgress()
  const s = useIndexSummary()
  const a = useIndexActions()
  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0

  if (s.needPermission) {
    return (
      <div className="idx-strip panel warn" data-testid="idx-permission">
        <IconShield />
        <div className="idx-body">
          <b>Папка «{s.folder}» подключена, но браузер просит подтвердить доступ</b>
          <span className="label-mono">
            Разрешение на чтение выдаётся по клику — без него индексатор не откроет ни один файл
          </span>
        </div>
        <button
          className="btn btn-tertiary btn-sm"
          data-testid="idx-grant"
          onClick={() => void a.grantPermission()}
        >
          Подтвердить доступ
        </button>
      </div>
    )
  }

  if (s.busy) {
    return (
      <div className="idx-strip panel busy" data-testid="idx-progress">
        <IconRefresh />
        <div className="idx-body">
          <b>
            {PHASE_LABEL[p.phase]} · {p.done}
            {p.total > 0 ? ` из ${p.total}` : ''} файлов
            {where === 'main' ? ' · главный поток' : ' · фоновый воркер'}
          </b>
          <span className="label-mono idx-current">{p.current || 'подготовка'}</span>
          <div className="idx-bar">
            <i style={{ width: `${p.phase === 'scan' ? 4 : pct}%` }} />
          </div>
        </div>
        <button className="btn btn-tertiary btn-sm" data-testid="idx-cancel" onClick={a.cancel}>
          <IconClose />
          Отменить
        </button>
      </div>
    )
  }

  if (p.phase === 'done' || p.phase === 'cancelled' || p.phase === 'error') {
    return (
      <div
        className={`idx-strip panel${p.phase === 'done' ? '' : ' warn'}`}
        data-testid="idx-result"
      >
        {p.phase === 'done' ? <IconCheck /> : <IconShield />}
        <div className="idx-body">
          <b>
            {PHASE_LABEL[p.phase]}
            {s.folder ? ` · ${s.folder}` : ''}
          </b>
          <span className="label-mono">
            прочитано заново {p.indexed} · без изменений {p.skipped}
            {p.failed > 0 ? ` · не прочитано ${p.failed}` : ''} · в индексе {s.indexedCount}
            {p.error ? ` · ${p.error}` : ''}
          </span>
        </div>
        {s.folderMode === 'fsa' ? (
          <button
            className="btn btn-tertiary btn-sm"
            data-testid="idx-disconnect"
            onClick={() => void a.disconnect()}
            title="Стереть индекс и отключить папку. Файлы на диске не тронуты."
          >
            Отключить
          </button>
        ) : null}
      </div>
    )
  }

  if (s.indexedCount > 0) {
    return (
      <div className="idx-strip panel" data-testid="idx-idle">
        <IconCheck />
        <div className="idx-body">
          <b>Индекс на месте{s.folder ? ` · ${s.folder}` : ''}</b>
          <span className="label-mono">
            {s.indexedCount} файлов с прочитанным содержимым · поиск ищет по тексту
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="idx-strip panel" data-testid="idx-empty">
      <IconShield />
      <div className="idx-body">
        <b>Индекса содержимого нет</b>
        <span className="label-mono">
          {s.fsaSupported
            ? 'Подключите папку — файлы прочитаются локально в фоновом воркере, ни один байт не уйдёт наружу'
            : 'Браузер не даёт доступ к папке: выберите файлы кнопкой «Добавить файл» — содержимое всё равно читается локально'}
        </span>
      </div>
    </div>
  )
}
