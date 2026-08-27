'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconBell, IconCheck, IconClose, iconOf } from './icons'
import { useVault, type Notif, type NotifCat, type NotifKind } from '@/lib/vault-store'
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

type Tab = 'all' | NotifCat

const TABS: Tab[] = ['all', 'pipeline', 'privacy', 'system']

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
 * Лента живёт в едином сейфе: сюда попадают те же события, которые породили
 * приём файлов, сожжённые стикеры и смена движка, а вкладки категорий
 * подчиняются переключателям уведомлений из настроек — выключенная категория
 * перестаёт наполняться и честно об этом говорит.
 */
export function NotificationsBell() {
  const v = useVault()
  const [open, setOpen] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const items = v.notifs
  const unread = v.unread
  const now = v.now || Date.now()

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onScroll(e: Event) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  /** Счётчики вкладок считаются по всей ленте, а не по отфильтрованной. */
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: items.length, pipeline: 0, privacy: 0, system: 0 }
    for (const n of items) c[n.cat] += 1
    return c
  }, [items])

  const shown = useMemo(() => {
    let list = items
    if (tab !== 'all') list = list.filter((n) => n.cat === tab)
    if (onlyUnread) list = list.filter((n) => n.unread)
    return [...list].sort((a, b) => b.at - a.at)
  }, [items, onlyUnread, tab])

  /** Группировка по дню: заголовок печатается только при смене дня. */
  const groups = useMemo(() => {
    const out: { day: string; list: Notif[] }[] = []
    for (const n of shown) {
      const day = dayLabel(n.at, now)
      const last = out[out.length - 1]
      if (last && last.day === day) last.list.push(n)
      else out.push({ day, list: [n] })
    }
    return out
    // подписи дней пересчитываются раз в сутки, поэтому now в зависимостях безопасен
  }, [shown, now])

  const digestOn = v.settings.toggles.ntfDigest
  const mutedCats = TABS.filter((t) => {
    const key = t === 'all' ? null : CAT_TOGGLE[t]
    return key ? !v.settings.toggles[key] : false
  })

  return (
    <div className="notif" ref={rootRef}>
      <button
        className={`icon-btn notif-btn${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Уведомления"
        aria-label={unread ? `Уведомления: ${unread} новых` : 'Уведомления'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <IconBell />
        {unread > 0 && (
          <span className="notif-badge num" aria-hidden="true">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Уведомления" ref={panelRef}>
          <div className="notif-head">
            <span className="label-mono">Уведомления</span>
            <span className="notif-head-count num">
              {unread > 0 ? `${unread} новых` : 'всё прочитано'}
            </span>
            <span className="grow" />
            <button
              className="notif-link"
              onClick={() => setOnlyUnread((u) => !u)}
              title="Показывать только непрочитанные"
              aria-pressed={onlyUnread}
            >
              {onlyUnread ? 'Показать все' : 'Только новые'}
            </button>
            <button
              className="notif-link"
              onClick={v.markAllRead}
              disabled={unread === 0}
              title="Отметить все прочитанными"
            >
              Прочитать все
            </button>
          </div>

          <div className="notif-tabs" role="tablist" aria-label="Категории уведомлений">
            {TABS.map((t) => {
              const key = t === 'all' ? null : CAT_TOGGLE[t]
              const off = key ? !v.settings.toggles[key] : false
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={`notif-tab${tab === t ? ' on' : ''}`}
                  onClick={() => setTab(t)}
                  title={
                    off
                      ? `Категория выключена в настройках — новые события не приходят`
                      : t === 'all'
                        ? 'Все события сейфа'
                        : `События: ${CAT_LABEL[t as NotifCat].toLowerCase()}`
                  }
                >
                  {t === 'all' ? 'Все' : CAT_LABEL[t as NotifCat]}
                  <b className="num">{off ? 'off' : counts[t]}</b>
                </button>
              )
            })}
          </div>

          <div className="notif-list">
            {groups.length === 0 && (
              <div className="notif-empty">
                <span className="notif-empty-mark" aria-hidden="true">
                  <IconCheck />
                </span>
                <div className="notif-empty-title">
                  {onlyUnread
                    ? 'Непрочитанных нет'
                    : tab === 'all'
                      ? 'Событий пока нет'
                      : `В категории «${CAT_LABEL[tab as NotifCat]}» пусто`}
                </div>
                <div className="notif-empty-note">
                  Конвейер сообщит здесь о новых файлах, тегах и рисках приватности.
                </div>
              </div>
            )}

            {groups.map((g) => (
              <div key={g.day} className="notif-group">
                <div className="notif-day label-mono">{g.day}</div>
                {g.list.map((n) => {
                  const Icon = iconOf(n.icon)
                  return (
                    <div key={n.id} className={`notif-item k-${n.kind}${n.unread ? ' unread' : ''}`}>
                      <span className="notif-ico" aria-hidden="true">
                        <Icon />
                      </span>
                      <button
                        className="notif-body"
                        onClick={() => v.toggleRead(n.id)}
                        title={n.unread ? 'Отметить прочитанным' : 'Отметить непрочитанным'}
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
                      <button
                        className="notif-x"
                        onClick={() => v.dismissNotif(n.id)}
                        title="Убрать уведомление"
                        aria-label={`Убрать: ${n.title}`}
                      >
                        <IconClose />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="notif-foot">
            <span className="notif-foot-note">
              {mutedCats.length > 0
                ? `Выключено категорий: ${mutedCats.length}`
                : digestOn
                  ? 'Конвейер приходит одной сводкой'
                  : 'Уведомления не выходят за пределы устройства'}
            </span>
            <button
              className="notif-link"
              onClick={() => {
                setOpen(false)
                v.openSetting('notifs')
              }}
            >
              Настроить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
