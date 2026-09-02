import { expect, type Page } from '@playwright/test'

/**
 * Дождаться, пока каркас оживёт. Кнопки навигации рисует сервер, но до
 * гидратации обработчиков на них нет: клик в эту щель пропадает молча, и
 * сценарий потом минуту ждёт экран, который никто не открывал.
 * Признак готовности честный — атрибут ставит сам каркас после монтирования.
 */
export async function waitAppReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-app-ready', '1', {
    timeout: 30_000,
  })
}
