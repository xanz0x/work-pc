'use client'

/* ============================================================
   СТОР · ЗАМОК (AR-1)
   Мастер-ключ, статус замка, анти-брутфорс, автоблокировка и
   синхронизация вкладок. Домен намеренно узкий: единственное, что он
   знает о данных, — стикеры, которые нужно переупаковать при смене
   мастера. Куда вести интерфейс после закрытия сейфа — не его дело:
   он поднимает `lockEpoch`, а навигация реагирует сама.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { adoptMasterSession, getMasterSession } from '@/hooks/use-file-keys'
import {
  b64ToBytes,
  cryptoAvailable,
  deriveMasterKey,
  LOCK_PING_KEY,
  LOCK_STATE_KEY,
  readLockState,
  registerFailure,
  resetFailures,
  setMasterSecret,
  verifyMasterSecret,
} from '../crypto-vault'
import { migrateKdfIterations, rewrapAll } from '../lock-migrate'
import {
  auditLockState,
  broadcastLockNow,
  brokenLockedNoteIds,
  countFileKeys,
  DEFAULT_AUTOLOCK_MIN,
  LOCK_CHANNEL_ID,
  LOCK_CONFIG_KEY,
  postLockSync,
  readLockBootstrap,
  readLockConfig,
  readLockSyncMsg,
  validateSecret,
  wipeLockData,
  writeLockConfig,
  type LockConfig,
  type LockMethod,
} from '../lock-store'
import { useDataStore } from './data'
import { useNotifsStore } from './notifs'

export type LockStatus = 'off' | 'locked' | 'unlocked'

/**
 * Срез замка для UI. Сам мастер-ключ нигде не хранится: он выводится
 * из секрета на время одной проверки и умирает вместе с ней (п.10.8).
 */
export type LockView = {
  status: LockStatus
  method: LockMethod | null
  autoLockMin: number
  /** Идёт деривация PBKDF2 — повторные попытки игнорируются (п.10.8). */
  busy: boolean
  /** Ввод заблокирован анти-брутфорсом до этого мгновения. */
  cooldownUntil: number
  failCount: number
  /** Когда встал замок — подпись на экране блокировки. */
  lockedAt: number
}

export const OFF_LOCK: LockView = {
  status: 'off',
  method: null,
  autoLockMin: 0,
  busy: false,
  cooldownUntil: 0,
  failCount: 0,
  lockedAt: 0,
}

/** useLayoutEffect молчит на сервере — SSR-прогон провайдера не шумит в консоль. */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export type LockCtx = {
  lock: LockView
  /**
   * Счётчик закрытий замка: растёт на каждом lockNow. Экраны сбрасывают
   * по нему локальный sel/фильтры, которые провайдеру недоступны (п.10.4).
   */
  lockEpoch: number
  /** Сколько объектов лежит под файловым ключом. */
  fileKeysCount: number
  setupLock: (secret: string, method: LockMethod) => Promise<string | null>
  changeMaster: (
    currentSecret: string,
    nextSecret: string,
    nextMethod?: LockMethod,
  ) => Promise<string | null>
  disableLock: (currentSecret: string) => Promise<string | null>
  lockNow: () => void
  unlock: (secret: string) => Promise<boolean>
  completeUnlock: () => void
  setAutoLock: (min: number) => void
  resetLock: () => void
}

const Ctx = createContext<LockCtx | null>(null)

export function LockProvider({ children }: { children: ReactNode }) {
  const { notify } = useNotifsStore()
  const D = useDataStore()
  const { notesRef, patchNote, patchNoteSecret, ready } = D

  /** Стартуем как SSR ('off'): первый клиентский рендер обязан совпасть с сервером. */
  const [lock, setLock] = useState<LockView>(OFF_LOCK)
  const [fileKeysCount, setFileKeysCount] = useState(0)
  const [lockEpoch, setLockEpoch] = useState(0)
  const lockRef = useRef(lock)
  lockRef.current = lock
  /** Последняя активность для автоблокировки; живёт только в памяти вкладки. */
  const activityRef = useRef(Date.now())

  /* ---------- синхронный bootstrap (п.10.1 / п.10.11) ---------- */

  /**
   * Первый клиентский рендер совпадает с SSR ('off'), затем — ещё до первой
   * отрисовки — состояние переключается на реальное. До этого момента контент
   * накрыт предгидратационной заглушкой html.lock-pending из layout.tsx,
   * поэтому «мигнул открытым» невозможно ни при каком раскладе.
   */
  useIsoLayoutEffect(() => {
    const boot = readLockBootstrap()
    if (boot === 'locked') {
      const cfg = readLockConfig()
      const st = readLockState()
      setLock({
        status: 'locked',
        method: cfg?.method ?? 'pin',
        autoLockMin: cfg?.autoLockMin ?? DEFAULT_AUTOLOCK_MIN,
        busy: false,
        cooldownUntil: st && st.cooldownUntil > Date.now() ? st.cooldownUntil : 0,
        failCount: st?.failCount ?? 0,
        lockedAt: Date.now(),
      })
    } else {
      const cfg = readLockConfig()
      setLock({ ...OFF_LOCK, method: cfg?.enabled ? cfg.method : null })
    }
    // React подтвердил статус — снимаем заглушку первым же кадром.
    document.documentElement.classList.remove('lock-pending')
    setFileKeysCount(countFileKeys())
  }, [])

  /* Аудит целостности (п.10.12) — после гидратации, когда стикеры прочитаны. */
  useEffect(() => {
    if (!ready) return
    const report = auditLockState(notesRef.current)
    if (!report.ok) console.warn('[lock-audit]', report.issues, report.fixes)
    // Инвариант locked ⇒ ct: сломанные стикеры честно разблокируются.
    const broken = brokenLockedNoteIds(notesRef.current)
    if (broken.length > 0) {
      for (const id of broken) patchNote(id, (n) => ({ ...n, locked: false }))
      notify({
        kind: 'warn',
        cat: 'privacy',
        icon: 'shield',
        title: 'Целостность стикеров восстановлена',
        body: `${broken.length} ${broken.length === 1 ? 'стикер был' : 'стикеров были'} без шифртекста — блокировка снята.`,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  /* ---------- действия ---------- */

  const setupLock = useCallback(
    async (secret: string, method: LockMethod): Promise<string | null> => {
      if (lockRef.current.busy) return 'Идёт вывод ключа — секунду'
      const policyError = validateSecret(secret, method)
      if (policyError) return policyError
      if (!cryptoAvailable()) return 'WebCrypto недоступен в этом браузере — замок не работает'
      setLock((p) => ({ ...p, busy: true }))
      try {
        await setMasterSecret(secret)
        /* Сеанс мастера нужен сразу: менеджер секретов создаёт свой ключ поверх него. */
        await adoptMasterSession(secret)
        const nextCfg: LockConfig = {
          enabled: true,
          method,
          autoLockMin: readLockConfig()?.autoLockMin ?? DEFAULT_AUTOLOCK_MIN,
          createdAt: Date.now(),
        }
        writeLockConfig(nextCfg)
        activityRef.current = Date.now()
        postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
        setLock({
          status: 'unlocked',
          method,
          autoLockMin: nextCfg.autoLockMin,
          busy: false,
          cooldownUntil: 0,
          failCount: 0,
          lockedAt: 0,
        })
        notify({
          kind: 'ok',
          cat: 'privacy',
          icon: 'lockRound',
          title: 'Замок включён',
          body: `Мастер-ключ (${method === 'pin' ? 'PIN' : 'пароль'}) создан на этом устройстве. PBKDF2 · 600 000 итераций.`,
        })
        return null
      } catch (e) {
        setLock((p) => ({ ...p, busy: false }))
        return e instanceof Error ? e.message : 'Не удалось создать мастер-ключ'
      }
    },
    [notify],
  )

  /** Смена метода/мастера = полный re-setup; сессия не разрывается (п.10.7). */
  const changeMaster = useCallback(
    async (currentSecret: string, nextSecret: string, nextMethod?: LockMethod) => {
      if (lockRef.current.busy) return 'Идёт вывод ключа — секунду'
      const cfg = readLockConfig()
      if (!cfg?.enabled || !cryptoAvailable()) return 'Замок не настроен'
      setLock((p) => ({ ...p, busy: true }))
      try {
        if (!(await verifyMasterSecret(currentSecret))) {
          const st = registerFailure()
          setLock((p) => ({
            ...p,
            busy: false,
            failCount: st?.failCount ?? p.failCount + 1,
            cooldownUntil: st?.cooldownUntil ?? p.cooldownUntil,
          }))
          return 'Текущий ключ не подходит'
        }
        const method = nextMethod ?? cfg.method
        const policyError = validateSecret(nextSecret, method)
        if (policyError) {
          setLock((p) => ({ ...p, busy: false }))
          return policyError
        }
        /* Ключ старого мастера нужен до перезаписи состояния — им расшифруем обёртки. */
        const prevState = readLockState()
        let oldKey: CryptoKey | null = getMasterSession()
        if (!oldKey && prevState) {
          oldKey = await deriveMasterKey(
            currentSecret,
            b64ToBytes(prevState.saltB64),
            prevState.iterations,
          )
        }
        await setMasterSecret(nextSecret) // свежая соль + верификатор, счётчики в ноль
        resetFailures()
        /* Всё, что было завёрнуто прежним мастером (файловые ключи, секреты
           стикеров, ключ сейфа секретов), переупаковывается под новый —
           иначе смена мастера тихо ломает уровень B. */
        const nextState = readLockState()
        if (oldKey && nextState) {
          try {
            const newKey = await deriveMasterKey(
              nextSecret,
              b64ToBytes(nextState.saltB64),
              nextState.iterations,
            )
            await rewrapAll(oldKey, newKey, notesRef.current, patchNoteSecret)
          } catch {
            /* переупаковка не удалась — сообщим ниже, данные не потеряны */
          }
        }
        await adoptMasterSession(nextSecret)
        writeLockConfig({ ...cfg, enabled: true, method })
        activityRef.current = Date.now()
        postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
        setLock((p) => ({
          ...p,
          status: 'unlocked',
          method,
          busy: false,
          cooldownUntil: 0,
          failCount: 0,
        }))
        notify({
          kind: 'ok',
          cat: 'privacy',
          icon: 'lockRound',
          title: 'Мастер-ключ изменён',
          body: 'Верификатор пересоздан с новой солью. Файловые ключи будут пере-обёрнуты при следующем открытии.',
        })
        return null
      } catch (e) {
        setLock((p) => ({ ...p, busy: false }))
        return e instanceof Error ? e.message : 'Не удалось изменить мастер-ключ'
      }
    },
    [notify, notesRef, patchNoteSecret],
  )

  const disableLock = useCallback(
    async (currentSecret: string): Promise<string | null> => {
      if (lockRef.current.busy) return 'Идёт вывод ключа — секунду'
      if (!readLockConfig()?.enabled) return 'Замок и так выключен'
      setLock((p) => ({ ...p, busy: true }))
      try {
        if (!(await verifyMasterSecret(currentSecret))) {
          const st = registerFailure()
          setLock((p) => ({
            ...p,
            busy: false,
            failCount: st?.failCount ?? p.failCount + 1,
            cooldownUntil: st?.cooldownUntil ?? p.cooldownUntil,
          }))
          return 'Ключ не подходит'
        }
        /* Без мастера файловые ключи невосстановимы — честно стираем и их (план п.4). */
        wipeLockData()
        setFileKeysCount(0)
        postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
        setLock({ ...OFF_LOCK })
        notify({
          kind: 'warn',
          cat: 'privacy',
          icon: 'shield',
          title: 'Замок выключен',
          body: 'Мастер-ключ и файловые ключи стёрты. Содержимое сейфа осталось без защиты.',
        })
        return null
      } catch (e) {
        setLock((p) => ({ ...p, busy: false }))
        return e instanceof Error ? e.message : 'Не удалось выключить замок'
      }
    },
    [notify],
  )

  const lockNow = useCallback(() => {
    if (lockRef.current.status !== 'unlocked') return
    broadcastLockNow() // п.10.9: остальные вкладки закрываются той же командой
    activityRef.current = Date.now()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    /* п.10.4: замок забывает всё выбранное — фокусы сбрасывает навигация,
       увидев новую эпоху; локальный sel экраны сбрасывают сами. */
    setLockEpoch((n) => n + 1)
    setLock((p) => ({
      ...p,
      status: 'locked',
      busy: false,
      lockedAt: Date.now(),
      cooldownUntil: 0,
      failCount: 0,
    }))
    notify({
      kind: 'info',
      cat: 'privacy',
      icon: 'lockRound',
      title: 'Сейф заблокирован',
      body: 'Для входа снова нужен мастер-ключ. Разблокировка не переносится между вкладками.',
    })
  }, [notify])

  /**
   * Криптопроверка без смены статуса. Деривация запускается ровно один раз
   * за попытку; повторные клики и ввод во время кулдауна игнорируются (п.10.8).
   */
  const unlock = useCallback(
    async (secret: string): Promise<boolean> => {
      const cur = lockRef.current
      if (cur.busy || cur.status !== 'locked') return false
      if (cur.cooldownUntil > Date.now()) return false
      if (!readLockState()) return false
      setLock((p) => ({ ...p, busy: true }))
      let ok = false
      try {
        ok = await verifyMasterSecret(secret)
      } catch {
        ok = false
      }
      if (ok) {
        resetFailures()
        /* Ленивая миграция KDF 310k → 600k: только после подтверждённого пароля,
           с бэкапом старой схемы и переупаковкой всех обёрток (гейт §6 ТЗ). */
        try {
          const mig = await migrateKdfIterations(secret, notesRef.current, patchNoteSecret)
          if (mig.migrated) {
            notify({
              kind: 'ok',
              cat: 'privacy',
              icon: 'shield',
              title: 'Замок усилен: PBKDF2 600 000',
              body: `Итерации подняты с ${mig.from.toLocaleString('ru-RU')} до ${mig.to.toLocaleString('ru-RU')}. Переупаковано ключей файлов: ${mig.report.files}, секретов стикеров: ${mig.report.notes}.`,
            })
          }
        } catch {
          /* миграция не обязана мешать входу */
        }
        setLock((p) => ({ ...p, busy: false, cooldownUntil: 0, failCount: 0 }))
      } else {
        const st = registerFailure()
        const fails = st?.failCount ?? lockRef.current.failCount + 1
        const cooldownSec =
          st?.cooldownUntil && st.cooldownUntil > Date.now()
            ? Math.max(1, Math.ceil((st.cooldownUntil - Date.now()) / 1000))
            : null
        setLock((p) => ({
          ...p,
          busy: false,
          failCount: fails,
          cooldownUntil: st?.cooldownUntil ?? Date.now(),
        }))
        /* Лента сейфа: попытки входа видны даже тому, кто сидит в другой вкладке. */
        notify({
          kind: 'warn',
          cat: 'privacy',
          icon: 'lockRound',
          title: `Неудачная попытка входа (${fails})`,
          body: cooldownSec
            ? `Мастер-ключ не подошёл. Следующая попытка через ${cooldownSec} с.`
            : 'Мастер-ключ не подошёл. Проверка шла локально.',
        })
      }
      return ok
    },
    [notify, notesRef, patchNoteSecret],
  )

  const completeUnlock = useCallback(() => {
    activityRef.current = Date.now()
    setLock((p) =>
      p.status === 'locked' ? { ...p, status: 'unlocked', busy: false, lockedAt: 0 } : p,
    )
    setFileKeysCount(countFileKeys())
    notify({
      kind: 'ok',
      cat: 'privacy',
      icon: 'check',
      title: 'Сейф разблокирован',
      body: 'Ключ проверен локально: PBKDF2 · AES-GCM. Ни один байт не покинул устройство.',
    })
  }, [notify])

  const setAutoLock = useCallback((min: number) => {
    const cfg = readLockConfig()
    if (cfg) writeLockConfig({ ...cfg, autoLockMin: min })
    setLock((p) => ({ ...p, autoLockMin: min }))
    postLockSync('unlock-config-changed') // п.10.9: таймер автоблока одинаков во вкладках
  }, [])

  /** Путь «забыл мастер»: без подтверждения, зато с честной ценой — файловые ключи. */
  const resetLock = useCallback(() => {
    wipeLockData()
    setFileKeysCount(0)
    postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
    setLock({ ...OFF_LOCK })
    notify({
      kind: 'danger',
      cat: 'privacy',
      icon: 'trash',
      title: 'Замок сброшен',
      body: 'Мастер-ключ и файловые ключи стёрты. Файлы остались, пароли к ним — нет.',
    })
  }, [notify])

  /* Автоблокировка: тик раз в 5 секунд против последней активности (план п.2.4). */
  useEffect(() => {
    const t = setInterval(() => {
      const L = lockRef.current
      if (
        L.status === 'unlocked' &&
        L.autoLockMin > 0 &&
        Date.now() - activityRef.current > L.autoLockMin * 60_000
      ) {
        lockNow()
      }
    }, 5000)
    return () => clearInterval(t)
  }, [lockNow])

  /* Активность продлевает таймер: click/keydown/pointermove, throttle 10 с. */
  useEffect(() => {
    let last = 0
    const touch = () => {
      const t = Date.now()
      if (t - last > 10_000) {
        last = t
        activityRef.current = t
      }
    }
    window.addEventListener('pointermove', touch, { passive: true })
    window.addEventListener('pointerdown', touch, { passive: true })
    window.addEventListener('keydown', touch, { passive: true })
    return () => {
      window.removeEventListener('pointermove', touch)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
    }
  }, [])

  /* Хоткей блокировки — Ctrl/Cmd+Shift+L (п.10.10: Ctrl+L занят браузером). */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        lockNow()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lockNow])

  /* Вкладки синхронны (п.10.9): setup/disable виден всем, ping закрывает всех,
     а unlock остаётся частным делом вкладки — его наружу никто не транслирует.
     storage-события дублирует BroadcastChannel('workflow-lock'): в приватных
     окнах и части браузеров storage между вкладками не доходит, канал надёжнее. */
  useEffect(() => {
    function applyPing() {
      if (lockRef.current.status === 'unlocked') lockNow()
    }
    function applyConfigChange() {
      if (readLockBootstrap() === 'off') {
        setLock({ ...OFF_LOCK })
        return
      }
      const cfg = readLockConfig()
      setLock((p) =>
        p.status === 'unlocked'
          ? {
              ...p,
              method: cfg?.method ?? p.method,
              autoLockMin: cfg?.autoLockMin ?? p.autoLockMin,
            }
          : {
              ...p,
              status: 'locked',
              method: cfg?.method ?? 'pin',
              autoLockMin: cfg?.autoLockMin ?? DEFAULT_AUTOLOCK_MIN,
            },
      )
    }
    function syncFromStorage(key: string | null) {
      if (key === LOCK_PING_KEY) return applyPing()
      if (key !== LOCK_CONFIG_KEY && key !== LOCK_STATE_KEY) return
      applyConfigChange()
    }
    function onStorage(e: StorageEvent) {
      syncFromStorage(e.key)
    }
    let ch: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        ch = new BroadcastChannel(LOCK_CHANNEL_ID)
        ch.onmessage = (e: MessageEvent) => {
          const m = readLockSyncMsg(e.data)
          if (!m) return
          if (m.type === 'lock') applyPing()
          else applyConfigChange()
        }
      }
    } catch {
      /* нет канала — остаётся storage-сигнал */
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      ch?.close()
    }
  }, [lockNow])

  const value = useMemo<LockCtx>(
    () => ({
      lock,
      lockEpoch,
      fileKeysCount,
      setupLock,
      changeMaster,
      disableLock,
      lockNow,
      unlock,
      completeUnlock,
      setAutoLock,
      resetLock,
    }),
    [
      lock, lockEpoch, fileKeysCount, setupLock, changeMaster, disableLock, lockNow, unlock,
      completeUnlock, setAutoLock, resetLock,
    ],
  )

  /* Стикеры участвуют только в аудите и миграциях, поэтому читаются через ref:
     их изменение не пересобирает контекст замка. */
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLockStore(): LockCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLockStore вызван вне LockProvider')
  return v
}
