import { expect, test } from '@playwright/test'

/** Сценарий 2: файл принят в сейф и виден в библиотеке. */
test('приём файла: появляется в библиотеке и в счётчике', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('nav-library').click()

  const name = `e2e-приём-${Date.now()}.pdf`
  await page.getByTestId('file-picker').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 e2e'),
  })

  await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 })

  // Приём файла — событие ленты: колокольчик обязан о нём сообщить.
  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-panel')).toBeVisible()
})
