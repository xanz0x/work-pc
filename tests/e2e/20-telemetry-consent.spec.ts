import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Сценарий 20 (NF-9).
 *
 * Телеметрия по согласию: по умолчанию выключена, payload виден целиком
 * до первой отправки, отзыв согласия стирает накопленное.
 */

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const APP_PASSWORD = process.env.APP_PASSWORD ?? 'IceKrymTeam13@'

test('NF-9: payload виден, отправка только по согласию, отзыв стирает данные', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(`${APP_URL}/login`)
  await page.getByTestId('login-password').fill(APP_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
  await skipOnboarding(page)
  await page.reload()
  await waitAppReady(page)

  /* Ходим по экранам — счётчики должны появиться сами. */
  for (const id of ['nav-map', 'nav-chat', 'nav-library', 'nav-settings']) {
    await page.getByTestId(id).click()
    await page.waitForTimeout(300)
  }

  const panel = page.getByTestId('telemetry-panel')
  await expect(panel).toBeVisible({ timeout: 30_000 })

  /* По умолчанию согласия нет: отправка недоступна. */
  await expect(page.getByTestId('telemetry-send')).toBeDisabled()
  await expect(page.getByTestId('telemetry-status')).toContainText('Согласие не дано')

  /* Payload показан целиком и состоит только из счётчиков. */
  await page.getByTestId('telemetry-payload-toggle').click()
  const raw = await page.getByTestId('telemetry-payload').innerText()
  const payload = JSON.parse(raw) as {
    screens: Record<string, number>
    totals: { screens: number }
  }
  expect(payload.totals.screens).toBeGreaterThan(0)
  expect(Object.values(payload.screens).every((v) => typeof v === 'number')).toBe(true)
  expect(raw).not.toContain('deviceId')

  /* Согласие включается тумблером и требует сохранения. */
  await page.getByTestId('toggle-telemetry').click()
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('telemetry-send')).toBeEnabled()

  await page.getByTestId('telemetry-send').click()
  await expect(page.getByTestId('telemetry-status')).toContainText('Отправлено', {
    timeout: 30_000,
  })
  /* Отправленное не отправляется второй раз. */
  await expect(page.getByTestId('telemetry-total')).toContainText('0')

  /* Копим заново и отзываем согласие — накопленное должно исчезнуть. */
  await page.getByTestId('nav-library').click()
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('telemetry-total')).not.toContainText('0 ')

  await page.getByTestId('toggle-telemetry').click()
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('telemetry-total')).toContainText('0')
  await expect(page.getByTestId('telemetry-send')).toBeDisabled()

  await ctx.close()
})
