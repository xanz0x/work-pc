import { expect, test } from '@playwright/test'

/**
 * Сценарий 8 (§1.5 хвоста волны 2): синхронизация вкладок.
 * Пока архив лежал в localStorage, события `storage` синхронизировали
 * вкладки бесплатно. Документы уехали в IndexedDB — событий нет, и две
 * вкладки расходились молча. Продуктовое решение: BroadcastChannel на
 * изменения документов. Тест проверяет именно это: приём файла в одной
 * вкладке виден во второй без перезагрузки.
 */
test('две вкладки: файл, принятый в первой, появляется во второй', async ({ context }) => {
  const first = await context.newPage()
  await first.goto('/')
  await first.getByTestId('nav-library').click()

  const second = await context.newPage()
  await second.goto('/')
  await second.getByTestId('nav-library').click()
  /* Ждём, пока вторая вкладка дочитает архив: иначе проверять нечего. */
  await expect(second.getByTestId('nav-library')).toBeVisible()
  await second.waitForTimeout(1500)

  const name = `e2e-вкладки-${Date.now()}.pdf`
  await first.getByTestId('file-picker').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 e2e-tabs'),
  })
  await expect(first.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 20_000 })

  /* Во второй вкладке файл обязан появиться сам, без перезагрузки. */
  await expect(second.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
})
