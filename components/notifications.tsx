'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconBell, IconCheck, IconClose, IconRefresh, iconOf } from './icons'
import { useVault, useNow, type Notif, type NotifCat, type NotifKind } from '@/lib/vault-store'
import { DAY } from '@/lib/notes'

const KIND_LABEL: Record<NotifKind, string> = {
  ok: 'готово',
  warn: 'нужно внимание',
  danger: 'риск приватности',
  info: 'событие',
}

const CAT_LABEL: Record<NotifCat, string> = {
  pipeline: 'Конвейер',
  privacy: 'Приватность',
  system: 'Система',
}

/** Категории, которые можно выключить на экране настроек. */
const CAT_TOGGLE = {
  pipeline: 'ntfPipeline',
  privacy: 'ntfPrivacy',
  system: null,
} as const

/** Одна ось фильтрации вместо вкладок + отдельного тумблера «только новые». */
type Filter = 'all' | 'unread' | NotifCat | 'archive'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Новые' },
  { id: 'pipeline', label: 'Конвейер' },
  { id: 'privacy', label: 'Приватность' },
  { id: 'system', label: 'Система' },
  { id: 'archive', label: 'Архив' },
]

/** Сколько живёт возможность отменить последнее действие. */
const UNDO_MS = 7000
/** Сколько уведомлений показываем сразу; остальное — по кнопке. */
const PAGE = 30

/** Короткая метка времени: «4 мин», «2 ч», «19:40». */
function stamp(at: number, now: number): string {
  const diff = Math.max(0, now - at)
  if (diff < 60_000) return 'сейчас'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)} ч`
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Заголовок дня для группировки: «Сегодня», «Вчера», «14 мар». */
function dayLabel(at: number, now: number): string {
  const a = new Date(at)
  const b = new Date(now)
  const same = (x: Date, y: Date) =>
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  if (same(a, b)) return 'Сегодня'
  const y = new Date(now - DAY)
  if (same(a, y)) return 'Вчера'
  return a.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/**
 * Колокольчик топбара с панелью событий.
 *
 * Модель поведения (утверждена в аудите, раздел 5):
 * — открытие панели ничего не читает;
 * — клик по телу открывает источник события и снимает unread;
 * — точка-статус слева переключает прочитано ⟷ непрочитано;
 * — крестик убирает в архив, «Очистить» переносит в архив пачкой,
 *   безвозвратное удаление живёт только в архиве;
 * — любое массовое действие 7 секунд можно отменить.
 */
export function NotificationsBell() {
  const v = useVault()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  /** Раскрытая сводка: показываем склеенные события списком. */
  const [openDigest, setOpenDigest] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const items = v.notifs
  const unread = v.unread
  const now = useNow() || Date.now()
  const undoLive = v.notifUndo !== null && now - v.notifUndo.at < UNDO_MS

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) setLimit(PAGE)
  }, [open, filter])

  const active = useMemo(
    () => items.filter((n) => !n.archived && !(n.snoozedUntil && n.snoozedUntil > now)),
    [items, now],
  )
  const archived = useMemo(() => items.filter((n) => n.archived), [items])

  /** Счётчик на чипе — непрочитанные, кроме архива (там всего записей). */
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: active.filter((n) => n.unread).length,
      unread: active.filter((n) => n.unread).length,
      pipeline: 0,
      privacy: 0,
      system: 0,
      archive: archived.length,
    }
    for (const n of active) if (n.unread) c[n.cat] += 1
    return c
  }, [active, archived])

  const shown = useMemo(() => {
    let list = filter === 'archive' ? archived : active
    if (filter === 'unread') list = list.filter((n) => n.unread)
    else if (filter !== 'all' && filter !== 'archive') list = list.filter((n) => n.cat === filter)
    return [...list].sort((a, b) => b.at - a.at)
  }, [active, archived, filter])

  const page = shown.slice(0, limit)

  /** Группировка по дню: заголовок печатается только при смене дня. */
  const groups = useMemo(() => {
    const out: { day: string; list: Notif[] }[] = []
    for (const n of page) {
      const day = dayLabel(n.at, now)
      const last = out[out.length - 1]
      if (last && last.day === day) last.list.push(n)
      else out.push({ day, list: [n] })
    }
    return out
    // подписи дней пересчитываются раз в сутки, поэтому now в зависимостях безопасен
  }, [page, now])

  const digestOn = v.settings.toggles.ntfDigest
  const mutedCats = (['pipeline', 'privacy'] as const).filter((t) => !v.settings.toggles[CAT_TOGGLE[t]])
  const inArchive = filter === 'archive'
  const readCount = active.filter((n) => !n.unread).length

  return (
    <div className="notif" ref={rootRef}>
      <button
        className={`icon-btn notif-btn${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Уведомления"
        aria-label={unread ? `Уведомления: ${unread} новых` : 'Уведомления'}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="notif-bell"
      >
        <IconBell />
        {unread > 0 && (
          <span className="notif-badge num" aria-hidden="true" data-testid="notif-badge">
            {unread}
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite" data-testid="notif-live">
        {unread > 0 ? `Непрочитанных уведомлений: ${unread}` : 'Все уведомления прочитаны'}
      </span>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Уведомления" ref={panelRef} data-testid="notif-panel">
          <div className="notif-head">
            <span className="label-mono">Уведомления</span>
            <span className="notif-head-count num" data-testid="notif-head-count">
              {unread > 0 ? `${unread} новых` : 'всё прочитано'}
            </span>
            <span className="grow" />
          </div>

          <div className="notif-bar">
            {inArchive ? (
              <button
                className="notif-link"
                onClick={v.purgeArchive}
                disabled={archived.length === 0}
                title="Стереть архив — 7 секунд можно отменить"
                data-testid="notif-purge-archive"
              >
                Стереть архив
              </button>
            ) : (
              <>
                <button
                  className="notif-link"
                  onClick={v.markAllRead}
                  disabled={unread === 0}
                  title="Отметить все прочитанными"
                  data-testid="notif-mark-all"
                >
                  Прочитать все
                </button>
                <button
                  className="notif-link"
                  onClick={v.clearRead}
                  disabled={readCount === 0}
                  title="Прочитанные уходят в архив — их можно вернуть"
                  data-testid="notif-clear-read"
                >
                  Очистить прочитанные
                </button>
                <button
                  className="notif-link"
                  onClick={v.clearAllNotifs}
                  disabled={active.length === 0}
                  title="Вся лента уходит в архив"
                  data-testid="notif-clear-all"
                >
                  Очистить всё
                </button>
              </>
            )}
          </div>

          {undoLive && v.notifUndo && (
            <div className="notif-undo" data-testid="notif-undo-bar">
              <IconRefresh />
              <span className="notif-undo-text">{v.notifUndo.label}</span>
              <button className="notif-link" onClick={v.undoNotifs} data-testid="notif-undo">
                Отменить
              </button>
            </div>
          )}

          <div className="notif-tabs" role="tablist" aria-label="Фильтр уведомлений">
            {FILTERS.map((f) => {
              const key = f.id === 'pipeline' || f.id === 'privacy' ? CAT_TOGGLE[f.id] : null
              const off = key ? !v.settings.toggles[key] : false
              return (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  className={`notif-tab${filter === f.id ? ' on' : ''}${off ? ' muted' : ''}`}
                  onClick={() => setFilter(f.id)}
                  title={
                    off
                      ? 'Категория выключена в настройках: новые события не приходят, накопленные остаются'
                      : f.id === 'archive'
                        ? 'Убранные уведомления: можно вернуть или удалить навсегда'
                        : f.id === 'unread'
                          ? 'Только непрочитанные'
                          : `Фильтр: ${f.label.toLowerCase()}`
                  }
                  data-testid={`notif-filter-${f.id}`}
                >
                  {f.label}
                  {counts[f.id] > 0 && <b className="num">{counts[f.id]}</b>}
                  {off && (
                    <i className="notif-off" aria-hidden="true" title="категория выключена" />
                  )}
                </button>
              )
            })}
          </div>

          <div className="notif-list">
            {!v.hydrated && (
              <div className="notif-empty" data-testid="notif-loading">
                <div className="notif-empty-title">Загрузка событий…</div>
              </div>
            )}

            {v.hydrated && groups.length === 0 && (
              <div className="notif-empty" data-testid="notif-empty">
                <span className="notif-empty-mark" aria-hidden="true">
                  <IconCheck />
                </span>
                <div className="notif-empty-title">
                  {filter === 'unread'
                    ? 'Непрочитанных нет'
                    : filter === 'archive'
                      ? 'Архив пуст'
                      : filter === 'all'
                        ? 'Событий пока нет'
                        : `В категории «${CAT_LABEL[filter as NotifCat]}» пусто`}
                </div>
                <div className="notif-empty-note">
                  {filter === 'archive'
                    ? 'Убранные уведомления появятся здесь и удалятся сами через 30 дней.'
                    : 'Конвейер сообщит здесь о новых файлах, тегах и рисках приватности.'}
                </div>
              </div>
            )}

            {groups.map((g) => (
              <div key={g.day} className="notif-group">
                <div className="notif-day label-mono">{g.day}</div>
                {g.list.map((n) => {
                  const Icon = iconOf(n.icon)
                  return (
                    <div
                      key={n.id}
                      className={`notif-item k-${n.kind}${n.unread ? ' unread' : ''}`}
                      data-testid={`notif-item-${n.id}`}
                      data-unread={n.unread ? 'true' : 'false'}
                    >
                      <span className="notif-ico" aria-hidden="true">
                        <Icon />
                      </span>
                      <button
                        className="notif-body"
                        onClick={() => {
                          v.openNotif(n.id)
                          setOpen(false)
                        }}
                        title="Открыть источник события"
                        data-testid={`notif-open-${n.id}`}
                      >
                        <span className="notif-row">
                          <span className="notif-item-title ellipsis">{n.title}</span>
                          <span className="notif-time num">{stamp(n.at, now)}</span>
                        </span>
                        <span className="notif-text">{n.body}</span>
                        <span className="notif-kind">
                          {CAT_LABEL[n.cat].toLowerCase()} · {KIND_LABEL[n.kind]}
                          {n.merged ? ` · склеено ${n.merged}` : ''}
                        </span>
                      </button>
                      {n.items?.length ? (
                        <div className="notif-digest">
                          <button
                            className="notif-link"
                            onClick={() => setOpenDigest((cur) => (cur === n.id ? null : n.id))}
                            aria-expanded={openDigest === n.id}
                            data-testid={`notif-digest-toggle-${n.id}`}
                          >
                            {openDigest === n.id
                              ? 'Свернуть события'
                              : `Показать ${n.items.length} ${n.items.length === 1 ? 'событие' : 'события'}`}
                          </button>
                          {openDigest === n.id ? (
                            <ul className="notif-digest-list" data-testid={`notif-digest-list-${n.id}`}>
                              {n.items.map((it) => (
                                <li key={it.id}>
                                  <span className="notif-digest-title">{it.title}</span>
                                  <span className="notif-digest-body">{it.body}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                      {!inArchive ? (
                        <div className="notif-extra">
                          <button
                            className="notif-link"
                            onClick={() => v.snoozeNotif(n.id, 3_600_000)}
                            title="Скрыть из ленты на час"
                            data-testid={`notif-snooze-${n.id}`}
                          >
                            Отложить на час
                          </button>
                          {CAT_TOGGLE[n.cat] ? (
                            <button
                              className="notif-link"
                              onClick={() => v.muteNotifCat(n.cat)}
                              title="Больше не присылать события этой категории"
                              data-testid={`notif-mute-${n.id}`}
                            >
                              Выключить категорию
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <span className="notif-acts">
                        <button
                          className={`notif-dot${n.unread ? ' on' : ''}`}
                          onClick={() => v.toggleRead(n.id)}
                          title={n.unread ? 'Отметить прочитанным' : 'Вернуть непрочитанным'}
                          aria-label={n.unread ? 'Отметить прочитанным' : 'Вернуть непрочитанным'}
                          aria-pressed={n.unread}
                          data-testid={`notif-toggle-${n.id}`}
                        />
                        {inArchive ? (
                          <>
                            <button
                              className="notif-x"
                              onClick={() => v.restoreNotif(n.id)}
                              title="Вернуть в ленту"
                              aria-label={`Вернуть: ${n.title}`}
                              data-testid={`notif-restore-${n.id}`}
                            >
                              <IconRefresh />
                            </button>
                            <button
                              className="notif-x danger"
                              onClick={() => v.deleteNotif(n.id)}
                              title="Удалить навсегда"
                              aria-label={`Удалить навсегда: ${n.title}`}
                              data-testid={`notif-delete-${n.id}`}
                            >
                              <IconClose />
                            </button>
                          </>
                        ) : (
                          <button
                            className="notif-x"
                            onClick={() => v.archiveNotif(n.id)}
                            title="Убрать в архив — можно вернуть"
                            aria-label={`Убрать: ${n.title}`}
                            data-testid={`notif-archive-${n.id}`}
                          >
                            <IconClose />
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}

            {shown.length > page.length && (
              <button
                className="notif-more"
                onClick={() => setLimit((l) => l + PAGE)}
                data-testid="notif-more"
              >
                Показать ещё {Math.min(PAGE, shown.length - page.length)} из {shown.length - page.length}
              </button>
            )}
          </div>

          <div className="notif-foot">
            <span className="notif-foot-note">
              {mutedCats.length > 0
                ? `Выключено категорий: ${mutedCats.length}`
                : digestOn
                  ? 'Конвейер приходит одной сводкой'
                  : 'Уведомления не выходят за пределы устройства'}
            </span>
            {!inArchive && (
              <span className="notif-foot-hint mono">архив хранится 30 дней</span>
            )}
            <button
              className="notif-link"
              onClick={() => {
                setOpen(false)
                v.openSetting('notifs')
              }}
              data-testid="notif-settings"
            >
              Настроить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
