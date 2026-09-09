import type { Page } from '@playwright/test'

/**
 * NF-4: сценарии ниже проверяют не первый запуск, а работу сейфа у человека,
 * который онбординг уже прошёл. Сеем флаг в профиль настроек до загрузки
 * страницы — иначе три шага честно перекрывают интерфейс и клики уходят в них.
 */
export async function skipOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const KEY = 'wf.settings.v1'
    try {
      const raw = localStorage.getItem(KEY)
      const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...prev,
          onboarding: { at: 1_700_000_000_000, mode: 'local', keyChoice: 'created', start: 'demo' },
        }),
      )
    } catch {
      /* приватный режим — тест просто увидит онбординг */
    }
  })
}
