import { expect, test } from '@playwright/test'

/**
 * Сценарий 11 (NF-4): первый запуск. Новый профиль обязан начать с трёх шагов,
 * выбрать режим осознанно, не проскочить мастер-ключ молча и больше не видеть
 * онбординг после перезагрузки.
 */
test('онбординг: три шага, ключ и повторный вход без онбординга', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')

  const onb = page.getByTestId('onboarding')
  await expect(onb).toBeVisible({ timeout: 30_000 })
  await expect(onb).toHaveAttribute('data-step', '1')

  /* Шаг 1: гибридный режим не пускает дальше без явного согласия. */
  await page.getByTestId('onb-mode-hybrid').click()
  await expect(page.getByTestId('onb-leaks')).toBeVisible()
  await expect(page.getByTestId('onb-step1-next')).toBeDisabled()
  await page.getByTestId('onb-cloud-ack').check()
  await page.getByTestId('onb-step1-next').click()
  await expect(onb).toHaveAttribute('data-step', '2')

  /* Шаг 2: расхождение PIN — честная ошибка, шаг не сменился. */
  await page.getByTestId('onb-secret').fill('123456')
  await page.getByTestId('onb-secret-repeat').fill('123457')
  await page.getByTestId('onb-create-key').click()
  await expect(page.getByTestId('onb-key-error')).toBeVisible()
  await expect(onb).toHaveAttribute('data-step', '2')

  /* Отказ фиксируется явно: одним кликом мимо ключа не проскочить. */
  await page.getByTestId('onb-decline').click()
  await expect(page.getByTestId('onb-decline-confirm')).toBeVisible()
  await page.getByTestId('onb-decline-no').click()
  await expect(page.getByTestId('onb-decline-confirm')).toBeHidden()

  await page.getByTestId('onb-secret-repeat').fill('123456')
  await page.getByTestId('onb-create-key').click()
  await expect(onb).toHaveAttribute('data-step', '3', { timeout: 60_000 })

  /* Шаг 3: демо — онбординг закрывается, режим применён. */
  await page.getByTestId('onb-pick-demo').click()
  await expect(onb).toBeHidden({ timeout: 15_000 })
  await expect(page.getByTestId('status-mode')).toHaveText('ГИБРИДНЫЙ РЕЖИМ')

  /* Замок включён: закрыли сейф — нужен тот же PIN. */
  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByLabel('Сейф заблокирован')).toBeVisible()

  /* Повторный вход: онбординг больше не показывается. */
  await page.reload()
  await expect(page.getByLabel('Сейф заблокирован')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('onboarding')).toHaveCount(0)
})
