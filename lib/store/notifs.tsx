'use client'

/* ============================================================
   СТОР · ЛЕНТА СОБЫТИЙ (AR-1)
   Домен уведомлений целиком: фильтр по категориям из настроек,
   сводка, retention, архив, отмена, синхронизация вкладок.
   Данные сейфа сюда не заходят — только события.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { IconId } from '@/components/icons'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { engineOf, modelOf } from '@/lib/data'
import { pruneNotifs } from '@/lib/notifs'
import { useSettingsStore, type ToggleId } from './settings'
import { useToast } from './toast'

export type NotifKind = 'ok' | 'warn' | 'danger' | 'info'
export type NotifCat = 'pipeline' | 'privacy' | 'system'

/** Куда ведёт уведомление: клик по телу открывает источник события. */
export type NotifLink =
  | { kind: 'file'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'secret'; id: string }
  | { kind: 'setting'; id: string }
  | { kind: 'screen'; id: string }

export type Notif = {
  id: string
  kind: NotifKind
  cat: NotifCat
  icon: IconId
  title: string
  body: string
  at: number
  unread: boolean
  archived?: boolean
  link?: NotifLink
  merged?: number
  items?: Notif[]
  snoozedUntil?: number
}

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`

export type NotifsCtx = {
  notifs: Notif[]
  ready: boolean
  unread: number
  notify: (n: Omit<Notif, 'id' | 'at' | 'unread'>) => void
  /** Первичная лента: наливается один раз данными сейфа. */
  seeded: boolean
  seededReady: boolean
  replaceNotifs: (list: Notif[]) => void
  markSeeded: () => void
  markAllRead: () => void
  toggleRead: (id: string) => void
  /** Снять unread; куда вести — решает сейф (он знает про экраны). */
  readNotif: (id: string) => Notif | undefined
  snoozeNotif: (id: string, ms: number) => void
  muteNotifCat: (cat: NotifCat) => void
  archiveNotif: (id: string) => void
  restoreNotif: (id: string) => void
  deleteNotif: (id: string) => void
  clearRead: () => void
  clearAllNotifs: () => void
  purgeArchive: () => void
  notifUndo: { label: string; at: number } | null
  undoNotifs: () => void
}

const Ctx = createContext<NotifsCtx | null>(null)

export function NotifsProvider({ children }: { children: ReactNode }) {
  const { flash } = useToast()
  const { settings, setToggle } = useSettingsStore()
  const [notifs, setNotifs, ready] = usePersistedState<Notif[]>('wf.notifs.v1', [])
  const [seeded, setSeeded, seededReady] = usePersistedState<boolean>('wf.notifs.seeded.v1', false)
  const [notifUndo, setNotifUndo] = useState<{ label: string; at: number } | null>(null)

  const notifsRef = useRef(notifs)
  notifsRef.current = notifs
  const togglesRef = useRef(settings.toggles)
  togglesRef.current = settings.toggles
  const snap = useRef<Notif[] | null>(null)
  const fromChannel = useRef(false)
  const channel = useRef<BroadcastChannel | null>(null)

  /**
   * Уведомление проходит через настройки: выключенная категория не создаёт
   * событие вообще, а включённая сводка склеивает поток конвейера в одну запись.
   */
  const notify = useCallback(
    (n: Omit<Notif, 'id' | 'at' | 'unread'>) => {
      const t = togglesRef.current
      if (n.cat === 'pipeline' && !t.ntfPipeline) return
      if (n.cat === 'privacy' && !t.ntfPrivacy) return

      if (n.cat === 'pipeline' && t.ntfDigest) {
        setNotifs((all) => {
          const i = all.findIndex((x) => x.id.startsWith('digest'))
          const item: Notif = { ...n, id: uid('n'), at: Date.now(), unread: true }
          if (i >= 0) {
            const cur = all[i]
            const items = [item, ...(cur.items ?? [])].slice(0, 50)
            const next: Notif = {
              ...cur,
              at: Date.now(),
              unread: true,
              body: n.body,
              merged: items.length,
              items,
              title: `Сводка конвейера: ${items.length} ${
                items.length === 1 ? 'событие' : 'события'
              }`,
            }
            return [next, ...all.filter((_, k) => k !== i)]
          }
          return [
            {
              id: `digest-${Date.now().toString(36)}`,
              kind: 'info',
              cat: 'pipeline',
              icon: 'inbox',
              title: 'Сводка конвейера: 1 событие',
              body: n.body,
              at: Date.now(),
              unread: true,
              merged: 1,
              items: [item],
            },
            ...all,
          ]
        })
        return
      }

      setNotifs((all) => pruneNotifs([{ ...n, id: uid('n'), at: Date.now(), unread: true }, ...all]))
    },
    [setNotifs],
  )

  /* Смена движка и модели — событие ленты, а не забота настроек. */
  const prevEngine = useRef<string | null>(null)
  const prevModel = useRef<string | null>(null)
  useEffect(() => {
    const engine = settings.engine
    const model = settings.model
    if (prevEngine.current === null) {
      prevEngine.current = engine
      prevModel.current = model
      return
    }
    if (prevModel.current !== model) {
      prevModel.current = model
      const m = modelOf(model)
      notify({
        kind: 'info',
        cat: 'system',
        icon: 'chipAi',
        title: `Модель в профиле: ${m.short}`,
        body: 'Локальный движок не подключён — модель выбрана на будущее, ответы идут через выбранный движок.',
      })
    }
    if (prevEngine.current !== engine) {
      prevEngine.current = engine
      const e = engineOf(engine)
      notify({
        kind: e.offline ? 'ok' : 'danger',
        cat: 'privacy',
        icon: e.offline ? 'lockRound' : 'shield',
        title: `Движок переключён: ${e.short}`,
        body: e.offline
          ? 'Внешних запросов больше нет. Локальный движок пока не подключён — чат ответит только после его появления.'
          : 'Часть запросов уйдёт наружу. Перед первым облачным ходом спросим согласие.',
      })
    }
  }, [notify, settings.engine, settings.model])

  /* Вкладки видят одну ленту. */
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel('workflow-notifs')
    channel.current = ch
    ch.onmessage = (e: MessageEvent) => {
      const list = (e.data as { notifs?: Notif[] } | null)?.notifs
      if (!Array.isArray(list)) return
      fromChannel.current = true
      setNotifs(list)
    }
    return () => {
      ch.close()
      channel.current = null
    }
  }, [setNotifs])

  useEffect(() => {
    if (!ready) return
    if (fromChannel.current) {
      fromChannel.current = false
      return
    }
    channel.current?.postMessage({ notifs })
  }, [notifs, ready])

  const remember = useCallback((label: string) => {
    snap.current = notifsRef.current
    setNotifUndo({ label, at: Date.now() })
  }, [])

  const undoNotifs = useCallback(() => {
    const prev = snap.current
    if (!prev) return
    snap.current = null
    setNotifUndo(null)
    setNotifs(prev)
    flash('Действие с уведомлениями отменено.')
  }, [flash, setNotifs])

  const markAllRead = useCallback(() => {
    if (!notifsRef.current.some((n) => n.unread && !n.archived)) return
    remember('Все отмечены прочитанными')
    setNotifs((all) => all.map((n) => (n.archived ? n : { ...n, unread: false })))
  }, [remember, setNotifs])

  const toggleRead = useCallback(
    (id: string) =>
      setNotifs((all) => all.map((n) => (n.id === id ? { ...n, unread: !n.unread } : n))),
    [setNotifs],
  )

  const readNotif = useCallback(
    (id: string) => {
      const n = notifsRef.current.find((x) => x.id === id)
      if (!n) return undefined
      setNotifs((all) => all.map((x) => (x.id === id ? { ...x, unread: false } : x)))
      return n
    },
    [setNotifs],
  )

  const archiveNotif = useCallback(
    (id: string) => {
      remember('Уведомление убрано')
      setNotifs((all) => all.map((n) => (n.id === id ? { ...n, archived: true } : n)))
    },
    [remember, setNotifs],
  )

  const restoreNotif = useCallback(
    (id: string) =>
      setNotifs((all) => all.map((n) => (n.id === id ? { ...n, archived: false } : n))),
    [setNotifs],
  )

  const deleteNotif = useCallback(
    (id: string) => setNotifs((all) => all.filter((n) => n.id !== id)),
    [setNotifs],
  )

  const snoozeNotif = useCallback(
    (id: string, ms: number) => {
      setNotifs((all) =>
        all.map((n) => (n.id === id ? { ...n, snoozedUntil: Date.now() + ms, unread: true } : n)),
      )
      flash('Уведомление отложено на час.')
    },
    [flash, setNotifs],
  )

  const muteNotifCat = useCallback(
    (cat: NotifCat) => {
      const key: ToggleId | null =
        cat === 'pipeline' ? 'ntfPipeline' : cat === 'privacy' ? 'ntfPrivacy' : null
      if (!key) {
        flash('Системные события выключить нельзя — это журнал сейфа.')
        return
      }
      setToggle(key, false)
      flash(`Категория «${cat === 'pipeline' ? 'Конвейер' : 'Приватность'}» выключена в настройках.`)
    },
    [flash, setToggle],
  )

  const clearRead = useCallback(() => {
    if (!notifsRef.current.some((n) => !n.unread && !n.archived)) return
    remember('Прочитанные убраны в архив')
    setNotifs((all) => all.map((n) => (!n.archived && !n.unread ? { ...n, archived: true } : n)))
  }, [remember, setNotifs])

  const clearAllNotifs = useCallback(() => {
    if (!notifsRef.current.some((n) => !n.archived)) return
    remember('Лента очищена в архив')
    setNotifs((all) => all.map((n) => (n.archived ? n : { ...n, archived: true, unread: false })))
  }, [remember, setNotifs])

  const purgeArchive = useCallback(() => {
    if (!notifsRef.current.some((n) => n.archived)) return
    remember('Архив стёрт')
    setNotifs((all) => all.filter((n) => !n.archived))
  }, [remember, setNotifs])

  const replaceNotifs = useCallback((list: Notif[]) => setNotifs(list), [setNotifs])
  const markSeeded = useCallback(() => setSeeded(true), [setSeeded])

  const unread = useMemo(() => notifs.filter((n) => n.unread && !n.archived).length, [notifs])

  const value = useMemo<NotifsCtx>(
    () => ({
      notifs,
      ready,
      unread,
      notify,
      seeded,
      seededReady,
      replaceNotifs,
      markSeeded,
      markAllRead,
      toggleRead,
      readNotif,
      snoozeNotif,
      muteNotifCat,
      archiveNotif,
      restoreNotif,
      deleteNotif,
      clearRead,
      clearAllNotifs,
      purgeArchive,
      notifUndo,
      undoNotifs,
    }),
    [
      archiveNotif, clearAllNotifs, clearRead, deleteNotif, markAllRead, markSeeded, muteNotifCat,
      notifUndo, notifs, notify, purgeArchive, readNotif, ready, replaceNotifs, restoreNotif,
      seeded, seededReady, snoozeNotif, toggleRead, undoNotifs, unread,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifsStore(): NotifsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNotifsStore вызван вне NotifsProvider')
  return v
}
