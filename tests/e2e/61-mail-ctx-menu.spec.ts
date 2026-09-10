import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'
import { dropBox, prepareRichMail } from './rich-mail'

/**
 * Контекстное меню внутри письма: правый клик по кнопке/ссылке, по обычному
 * тексту и по картинке. Тело письма живёт в песочнице iframe, поэтому ПКМ
 * ловит мост письма и присылает наружу то, что было под курсором.
 *
 * Сценарий самодостаточен: ящик временной почты и тестовое письмо готовит
 * ./rich-mail (ключи не нужны), свой ящик убирается за собой.
 */

async function closeMenu(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mail-ctx-menu')).toBeHidden()
}

async function rightClick(frame: FrameLocator, selector: string) {
  await frame.locator(selector).click({ button: 'right' })
}

test('меню письма: кнопка, текст и картинка', async ({ page }) => {
  const { box, row, mine } = await prepareRichMail(page.request)

  await skipOnboarding(page)
  await page.goto('/')
  await waitAppReady(page)
  await page.getByTestId('nav-mail').click()
  await page.getByTestId(`mail-temp-row-${box.id}`).click()
  await page.getByTestId(`mail-temp-open-${row.mid}`).click()
  await expect(page.getByTestId('mail-temp-frame')).toBeVisible()

  const frame = page.frameLocator('[data-testid="mail-temp-frame"]')
  await expect(frame.locator('#cta')).toBeVisible()

  /* Картинку скачивает страница и вставляет в письмо как data:-URI. */
  await expect(async () => {
    const w = await frame.locator('#pic').evaluate((el) => (el as HTMLImageElement).naturalWidth)
    expect(w).toBeGreaterThan(0)
  }).toPass({ timeout: 20_000 })
  const src = await frame.locator('#pic').getAttribute('src')
  expect(src).toMatch(/^data:image\//)

  /* 1. Кнопка-ссылка (CTA): меню знает адрес и текст ссылки. */
  await rightClick(frame, '#cta')
  const menu = page.getByTestId('mail-ctx-menu')
  await expect(menu).toBeVisible()
  await expect(page.getByTestId('mail-ctx-open')).toBeVisible()
  await expect(page.getByTestId('mail-ctx-copy-link')).toContainText('Копировать адрес ссылки')
  await expect(page.getByTestId('mail-ctx-copy-link')).toHaveAttribute('title', /example\.com\/confirm/)
  await expect(page.getByTestId('mail-ctx-copy-link-text')).toBeVisible()
  await closeMenu(page)

  /* 2. Обычный текст без выделения: копирование выделения недоступно,
        письмо целиком и «выделить всё» — доступны. */
  await rightClick(frame, '#lead')
  await expect(menu).toBeVisible()
  await expect(page.getByTestId('mail-ctx-open')).toHaveCount(0)
  await expect(page.getByTestId('mail-ctx-copy-text')).toBeDisabled()
  await expect(page.getByTestId('mail-ctx-copy-all')).toBeEnabled()
  await expect(page.getByTestId('mail-ctx-select-all')).toBeEnabled()
  await expect(page.getByTestId('mail-ctx-copy-subject')).toBeEnabled()
  await closeMenu(page)

  /* 3. Тот же абзац, но выделенный целиком (тройной клик): копирование
        выделения включается, и поиск по выделению тоже. */
  await frame.locator('#lead').click({ clickCount: 3 })
  await rightClick(frame, '#lead')
  await expect(menu).toBeVisible()
  await expect(page.getByTestId('mail-ctx-copy-text')).toBeEnabled()
  await expect(page.getByTestId('mail-ctx-search')).toBeEnabled()
  await closeMenu(page)

  /* 4. Картинка: открыть в новой вкладке и скопировать настоящий адрес. */
  await rightClick(frame, '#pic')
  await expect(menu).toBeVisible()
  await expect(page.getByTestId('mail-ctx-open-img')).toBeVisible()
  const copyImg = page.getByTestId('mail-ctx-copy-img')
  await expect(copyImg).toBeEnabled()
  await expect(copyImg).toHaveAttribute('title', /picsum\.photos/)
  await closeMenu(page)

  await dropBox(page.request, box, mine)
})
