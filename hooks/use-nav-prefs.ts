'use client'

/* ============================================================
   СТОР НАСТРОЕК МЕНЮ
   Порядок хранится на сервере у пользователя (AI_DIR/users/<uid>/nav.json),
   а локальная копия в localStorage даёт мгновенный первый кадр без
   перескакивания пунктов, пока идёт запрос.
   ============================================================ */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { NAV_DEFAULT, normalizeNavPrefs, type NavPrefs } from '@/lib/nav-prefs'

const CACHE_KEY = 'wf.nav.prefs.v1'
const API = '/ai-api/prefs/nav'

let prefs: NavPrefs | null = null
let fetched = false
let saveTimer = 0
const subs = new Set<() => void>()

function snapshot(): NavPrefs {
  if (prefs) return prefs
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    prefs = raw ? normalizeNavPrefs(JSON.parse(raw)) : NAV_DEFAULT
  } catch {
    prefs = NAV_DEFAULT
  }
  return prefs
}

function set(next: NavPrefs) {
  prefs = next
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {
    /* приватный режим */
  }
  subs.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

async function pull() {
  try {
    const r = await fetch(API, { cache: 'no-store' })
    if (r.ok) set(normalizeNavPrefs(await r.json()))
  } catch {
    /* сервер недоступен — живём на локальной копии */
  }
}

function push(next: NavPrefs) {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => null)
  }, 300)
}

export function useNavPrefs() {
  const value = useSyncExternalStore(subscribe, snapshot, () => NAV_DEFAULT)

  useEffect(() => {
    if (fetched) return
    fetched = true
    void pull()
  }, [])

  const update = useCallback((next: NavPrefs) => {
    const clean = normalizeNavPrefs(next)
    set(clean)
    push(clean)
  }, [])

  const reset = useCallback(() => update(NAV_DEFAULT), [update])

  return { prefs: value, update, reset }
}

/** Для тестов: сброс модульного состояния. */
export function resetNavPrefsStore(): void {
  prefs = null
  fetched = false
}
