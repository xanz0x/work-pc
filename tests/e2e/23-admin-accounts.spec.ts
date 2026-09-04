import { expect, test, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Сценарий 23: аккаунты и админ-панель.
 * Админ создаёт пользователя с временным паролем и выдаёт ключ лицензии;
 * пользователь в отдельном контексте проходит смену пароля и стену лицензии,
 * попадает в СВОЙ пустой сейф (онбординг с нуля) и не видит админку;
 * админ выключает ему функцию — раздел исчезает; блокировка выкидывает.
 */

async function loginAdmin(page: Page) {
  await skipOnboarding(page)
  await page.goto('/login')
  await page.getByTestId('login-password').fill(process.env.APP_PASSWORD as string)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })
  await waitAppReady(page)
}

test('аккаунты: создание, лицензия, изоляция, тумблеры, блокировка', async ({ browser }) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  test.setTimeout(180_000)
  const email = `e2e-${Date.now()}@test.local`
  const temp = 'temp-pass-12345'

  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await loginAdmin(a)
  await expect(a.getByTestId('profile-email')).toContainText('админ')
  await a.getByTestId('nav-admin').click()
  await expect(a.getByTestId('screen-admin')).toBeVisible()

  await a.getByTestId('admin-create-open').click()
  await a.getByTestId('admin-create-email').fill(email)
  await a.getByTestId('admin-create-name').fill('Ирина')
  await a.getByTestId('admin-create-password').fill(temp)
  await a.getByTestId('admin-create-days').selectOption('0')
  await a.getByTestId('admin-create-submit').click()
  await expect(a.getByTestId('admin-created-creds')).toContainText(email)
  await a.getByTestId('admin-license-issue').click()
  const key = (await a.getByTestId('admin-license-key').innerText()).trim()
  expect(key).toMatch(/^WSX(-[A-Z2-9]{4}){4}$/)

  /* Пользователь: временный пароль → своя → ключ → приложение. */
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await b.goto('/login')
  await b.getByTestId('login-email').fill(email)
  await b.getByTestId('login-password').fill(temp)
  await b.getByTestId('login-submit').click()
  await expect(b.getByTestId('access-wall')).toHaveAttribute('data-access', 'password', { timeout: 30_000 })
  await b.getByTestId('wall-password-next').fill('my-own-pass-123')
  await b.getByTestId('wall-password-again').fill('my-own-pass-123')
  await b.getByTestId('wall-password-submit').click()
  await expect(b.getByTestId('access-wall')).toHaveAttribute('data-access', 'license', { timeout: 15_000 })
  await b.getByTestId('wall-license-key').fill('WSX-AAAA-BBBB-CCCC-DDDD')
  await b.getByTestId('wall-license-submit').click()
  await expect(b.getByTestId('wall-error')).toBeVisible()
  await b.getByTestId('wall-license-key').fill(key)
  await b.getByTestId('wall-license-submit').click()
  /* Свой сейф: онбординг с нуля, админки в навигации нет. */
  await expect(b.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
  await expect(b.getByTestId('nav-admin')).toHaveCount(0)

  /* Тумблер: админ выключает менеджер секретов — у пользователя пункт исчезает после перезагрузки. */
  await a.getByTestId('admin-user-row').filter({ hasText: email }).click()
  await a.getByTestId('admin-feature-secrets').click()
  await a.getByTestId('admin-card-save').click()
  await b.reload()
  await expect(b.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
  await expect(b.getByTestId('nav-vault')).toHaveCount(0)
  await expect(a.getByTestId('nav-vault')).toHaveCount(1)

  /* Блокировка: пользователь выпадает на стену, вход отказывает. */
  await a.getByTestId('admin-card-block').click()
  await a.getByTestId('admin-card-block').click()
  await expect(a.getByTestId('admin-user-row').filter({ hasText: email }).getByTestId('admin-user-access')).toHaveText('заблокирован', {
    timeout: 15_000,
  })
  await b.reload()
  await expect(b).toHaveURL(/\/login/, { timeout: 30_000 })
  /* Форма входа должна гидратироваться, иначе submit уйдёт нативным GET. */
  await b.waitForLoadState('networkidle')
  await b.getByTestId('login-email').fill(email)
  await b.getByTestId('login-password').fill('my-own-pass-123')
  await b.getByTestId('login-submit').click()
  await expect(b.getByTestId('login-error')).toContainText('заблокирована')

  /* Удаление вместе с данными. */
  await a.getByTestId('admin-card-delete').click()
  await a.getByTestId('admin-card-delete').click()
  await expect(a.getByTestId('admin-user-row').filter({ hasText: email })).toHaveCount(0, { timeout: 15_000 })

  await ctxA.close()
  await ctxB.close()
})
