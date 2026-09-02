'use client'

/* ============================================================
   ЭКРАНЫ · ЛЕНИВАЯ ЗАГРУЗКА (AR-2)
   Пять экранов раньше приезжали статическими импортами: библиотека,
   карта и менеджер секретов лежали в первом бандле, даже если человек
   их не открывал. Теперь у каждого экрана свой чанк — вместе со своим
   слоем CSS (app/styles/screen-*.css, импорт стоит в самом экране).

   Префетч: сайдбар зовёт `prefetchScreen()` по наведению и фокусу, так
   что к моменту клика чанк уже в кэше — переход без заметной задержки.
   ============================================================ */

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type { ScreenId } from '@/lib/vault-store'

type Loader = () => Promise<{ default: ComponentType }>

/**
 * Чанк экрана может не доехать: сеть моргнула, прокси отдал ошибку, вкладка
 * ушла в сон посреди запроса. Раньше это выглядело как «экран не открылся и
 * ничего не сказал». Теперь загрузка повторяется дважды с паузой, а если
 * чанк так и не приехал — ошибка доходит до boundary и человек видит
 * карточку «Экран не открылся» с кнопкой «Открыть заново».
 */
function withRetry(load: Loader): Loader {
  return async () => {
    const delays = [400, 1200]
    let last: unknown
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await load()
      } catch (e) {
        last = e
        const wait = delays[attempt]
        if (wait === undefined) break
        await new Promise((r) => setTimeout(r, wait))
      }
    }
    throw last instanceof Error ? last : new Error('Чанк экрана не загрузился')
  }
}
const LOADERS: Record<ScreenId, Loader> = {
  library: () =>
    import('@/components/screen-library').then((m) => ({ default: m.ScreenLibrary })),
  map: () => import('@/components/screen-map').then((m) => ({ default: m.ScreenMap })),
  chat: () => import('@/components/screen-chat').then((m) => ({ default: m.ScreenChat })),
  vault: () => import('@/components/screen-vault').then((m) => ({ default: m.ScreenVault })),
  settings: () =>
    import('@/components/screen-settings').then((m) => ({ default: m.ScreenSettings })),
  activity: () =>
    import('@/components/screen-activity').then((m) => ({ default: m.ScreenActivity })),
}

/** Заглушка на время загрузки чанка: тон и ритм статус-бара, без прыжка вёрстки. */
function ScreenLoading() {
  return (
    <div
      data-testid="screen-loading"
      role="status"
      aria-live="polite"
      className="flex min-h-0 flex-1 items-center justify-center text-[11px] tracking-[0.18em] text-[var(--text-3)] uppercase"
    >
      Загрузка экрана…
    </div>
  )
}

export const SCREENS: Record<ScreenId, ComponentType> = {
  library: dynamic(withRetry(LOADERS.library), { ssr: false, loading: ScreenLoading }),
  map: dynamic(withRetry(LOADERS.map), { ssr: false, loading: ScreenLoading }),
  chat: dynamic(withRetry(LOADERS.chat), { ssr: false, loading: ScreenLoading }),
  vault: dynamic(withRetry(LOADERS.vault), { ssr: false, loading: ScreenLoading }),
  settings: dynamic(withRetry(LOADERS.settings), { ssr: false, loading: ScreenLoading }),
  activity: dynamic(withRetry(LOADERS.activity), { ssr: false, loading: ScreenLoading }),
}

const warmed = new Set<ScreenId>()

/** Догрузить чанк экрана заранее. Повторные вызовы бесплатны. */
export function prefetchScreen(id: ScreenId): void {
  if (warmed.has(id)) return
  warmed.add(id)
  void LOADERS[id]().catch(() => warmed.delete(id))
}
