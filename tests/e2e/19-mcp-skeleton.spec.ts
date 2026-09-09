import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Сценарий 19 (RM-3).
 *
 * Скелет MCP — незаконченная часть продукта. Пока флаг `mcp.skeleton`
 * выключен, его не должно быть видно вовсе; когда включён — всё, что он
 * отдаёт, обязано быть помечено как макет.
 */

test('RM-3: скелет MCP скрыт флагом, а включённый — помечен макетом', async ({ page }) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await page.goto('/')
  await waitAppReady(page)

  await page.getByTestId('nav-chat').click()
  await page.getByTestId('ai-hub-open').click()
  await expect(page.getByTestId('ai-hub-panel')).toBeVisible()
  /* Флаг по умолчанию выключен: вкладки MCP нет. */
  await expect(page.getByTestId('ai-hub-tab-mcp')).toHaveCount(0)

  await page.evaluate(() => {
    localStorage.setItem(
      'wf.flags.v1',
      JSON.stringify({
        v: 1,
        flags: { dev: false, experimental: false, 'mcp.skeleton': true },
        offline: false,
      }),
    )
  })
  await page.reload()
  await waitAppReady(page)
  await page.getByTestId('nav-chat').click()
  await page.getByTestId('ai-hub-open').click()

  const tab = page.getByTestId('ai-hub-tab-mcp')
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(page.getByTestId('mcp-mock-banner')).toContainText('Макет, не реальные данные')
})
