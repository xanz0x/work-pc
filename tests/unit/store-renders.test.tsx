// @vitest-environment jsdom

/* ============================================================
   AR-1 · ЦИФРЫ ВМЕСТО ОБЕЩАНИЙ
   Раньше `setInterval(setNow, 1000)` жил в общем контексте сейфа, и любой
   экран перерисовывался раз в секунду. Профилировать это руками —
   значит проверять один раз; вместо этого считаем рендеры прямо в тесте.

   Что закрепляем:
     1. секундный тик перерисовывает только подписчиков часов;
     2. тост (самый частый домен) не трогает домен данных;
     3. фасад `useVault()` продолжает отдавать все поля контракта.
   ============================================================ */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StrictMode, useEffect, useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClockProvider, useNow } from '@/lib/store/clock'
import { RedactedProvider } from '@/lib/redact-context'
import { VaultProvider, useVault } from '@/lib/vault-store'
import { useDataStore } from '@/lib/store/data'
import { useNavStore } from '@/lib/store/nav'
import { useToast } from '@/lib/store/toast'

// React 19 в тестовой среде ждёт этот флаг — иначе act() ругается.
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Counter = { renders: number }

/** Счётчик рендеров конкретного компонента. */
function useCount(c: Counter) {
  c.renders++
}

let root: Root | null = null
let host: HTMLDivElement | null = null

async function mount(ui: ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(ui)
  })
  // персистентное состояние читается асинхронно — даём ему осесть
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount()
    })
  }
  root = null
  host?.remove()
  host = null
  vi.useRealTimers()
})

describe('AR-1 · часы отделены от сейфа', () => {
  it('секундный тик перерисовывает только подписчика часов', async () => {
    vi.useFakeTimers()
    const clock: Counter = { renders: 0 }
    const screen: Counter = { renders: 0 }

    function ClockReader() {
      useCount(clock)
      const now = useNow()
      return <span>{now}</span>
    }
    function ScreenLike() {
      useCount(screen)
      return <span>экран без времени</span>
    }

    await mount(
      <ClockProvider>
        <ClockReader />
        <ScreenLike />
      </ClockProvider>,
    )

    const clockBefore = clock.renders
    const screenBefore = screen.renders

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
    }

    expect(clock.renders - clockBefore).toBe(3)
    expect(screen.renders - screenBefore).toBe(0)
  })

  it('внутри полного сейфа тик не трогает потребителей useVault()', async () => {
    vi.useFakeTimers()
    const clock: Counter = { renders: 0 }
    const screen: Counter = { renders: 0 }

    function ClockReader() {
      useCount(clock)
      return <span>{useNow()}</span>
    }
    function ScreenLike() {
      useCount(screen)
      const v = useVault()
      return <span>{v.stats.files}</span>
    }

    await mount(
      <RedactedProvider>
        <VaultProvider>
          <ClockReader />
          <ScreenLike />
        </VaultProvider>
      </RedactedProvider>,
    )

    /* Отложенный пересчёт графа (AR-1, шаг 3) обязан осесть до замера —
       иначе мы посчитаем его как «лишний рендер от часов». */
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    const clockBefore = clock.renders
    const screenBefore = screen.renders

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
    }

    // Часы тикнули трижды, экран не перерисовался ни разу.
    expect(clock.renders - clockBefore).toBe(3)
    expect(screen.renders - screenBefore).toBe(0)
  })
})

describe('AR-1 · действие перерисовывает свою область', () => {
  it('тост не задевает домен данных', async () => {
    vi.useFakeTimers()
    const toastC: Counter = { renders: 0 }
    const dataC: Counter = { renders: 0 }
    const flashRef: { current: ((m: string) => void) | null } = { current: null }

    function ToastReader() {
      useCount(toastC)
      const { toast, flash } = useToast()
      const ref = useRef(flash)
      ref.current = flash
      useEffect(() => {
        flashRef.current = (m: string) => ref.current(m)
      }, [])
      return <span>{toast ?? ''}</span>
    }
    function DataReader() {
      useCount(dataC)
      const D = useDataStore()
      return <span>{D.files.length}</span>
    }

    await mount(
      <RedactedProvider>
        <VaultProvider>
          <ToastReader />
          <DataReader />
        </VaultProvider>
      </RedactedProvider>,
    )

    /* даём осесть гидратации и отложенному графу */
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    const toastBefore = toastC.renders
    const dataBefore = dataC.renders

    await act(async () => {
      flashRef.current?.('Конфигурация записана')
    })

    expect(toastC.renders - toastBefore).toBe(1)
    expect(dataC.renders - dataBefore).toBe(0)
  })
})

describe('AR-1 · узкие подписки экранов', () => {
  it('строка поиска не перерисовывает домен данных, а тост — навигацию', async () => {
    vi.useFakeTimers()
    const navC: Counter = { renders: 0 }
    const dataC: Counter = { renders: 0 }
    const api: { setQuery: ((q: string) => void) | null; flash: ((m: string) => void) | null } = {
      setQuery: null,
      flash: null,
    }

    function NavReader() {
      useCount(navC)
      const NAV = useNavStore()
      const ref = useRef(NAV.setQuery)
      ref.current = NAV.setQuery
      useEffect(() => {
        api.setQuery = (q: string) => ref.current(q)
      }, [])
      return <span>{NAV.query}</span>
    }
    function DataReader() {
      useCount(dataC)
      const D = useDataStore()
      const { flash } = useToast()
      const ref = useRef(flash)
      ref.current = flash
      useEffect(() => {
        api.flash = (m: string) => ref.current(m)
      }, [])
      return <span>{D.files.length}</span>
    }

    await mount(
      <RedactedProvider>
        <VaultProvider>
          <NavReader />
          <DataReader />
        </VaultProvider>
      </RedactedProvider>,
    )
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    let navBefore = navC.renders
    let dataBefore = dataC.renders
    await act(async () => {
      api.setQuery?.('аренда')
    })
    // Поиск — дело навигации: корпус о нём не знает. Два прохода вместо одного:
    // строка перерисовывается сразу, а выдача считается на отложенном значении
    // (useDeferredValue в nav-сторе) — ввод не ждёт прохода по корпусу.
    expect(navC.renders - navBefore).toBe(2)
    expect(dataC.renders - dataBefore).toBe(0)

    navBefore = navC.renders
    dataBefore = dataC.renders
    await act(async () => {
      api.flash?.('Готово')
    })
    // Тост — свой домен: навигация не дёргается.
    expect(navC.renders - navBefore).toBe(0)
    expect(dataC.renders - dataBefore).toBe(1)
  })
})

describe('AR-1 · фасад useVault() сохраняет контракт', () => {
  it('все поля прежнего API на месте', async () => {
    const seen: { keys: string[] } = { keys: [] }

    function Probe() {
      const v = useVault()
      seen.keys = Object.keys(v)
      return null
    }

    await mount(
      <StrictMode>
        <RedactedProvider>
          <VaultProvider>
            <Probe />
          </VaultProvider>
        </RedactedProvider>
      </StrictMode>,
    )

    const required = [
      'hydrated', 'files', 'views', 'fileById', 'viewById', 'addFiles', 'applyIndexed',
      'setIndexing', 'dropIndexed', 'setFolder', 'setReindexHandler', 'removeFile', 'retagFile',
      'reindexAll', 'clearIndex', 'wipeVault', 'notes', 'liveNotes', 'notesFor', 'addNote',
      'patchNote', 'burnNote', 'extendNote', 'sessions', 'activeSessionId', 'setActiveSession',
      'addSession', 'patchSession', 'removeSession', 'drafts', 'setDraft', 'scrolls', 'setScroll',
      'settings', 'draftSettings', 'setDraftSettings', 'dirty', 'saveSettings', 'revertSettings',
      'notifs', 'unread', 'notify', 'markAllRead', 'toggleRead', 'openNotif', 'snoozeNotif',
      'muteNotifCat', 'archiveNotif', 'restoreNotif', 'deleteNotif', 'clearRead',
      'clearAllNotifs', 'purgeArchive', 'notifUndo', 'undoNotifs', 'dismissNotif', 'screen', 'go',
      'fileFocus', 'noteFocus', 'clusterFocus', 'nodeFocus', 'settingFocus', 'secretFocus',
      'openSecret', 'secretIndex', 'setSecretIndex', 'openFile', 'openNote', 'openOnMap',
      'openCluster', 'openSetting', 'openSession', 'query', 'setQuery', 'scope', 'setScope',
      'hits', 'matchedFiles', 'palette', 'setPalette', 'runHit', 'graph', 'clusters', 'mix',
      'neighbors', 'stats', 'engineView', 'grantCloudConsent', 'revokeCloudConsent', 'setToggle',
      'toast', 'flash', 'lock', 'lockEpoch', 'fileKeysCount', 'setupLock', 'changeMaster',
      'disableLock', 'lockNow', 'unlock', 'completeUnlock', 'setAutoLock', 'resetLock',
    ]
    const missing = required.filter((k) => !seen.keys.includes(k))
    expect(missing).toEqual([])
  })
})
