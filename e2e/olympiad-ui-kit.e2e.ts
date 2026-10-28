import { expect, test } from '@playwright/test'

// UI Kit uses synthetic role projections and never writes to a family account.
test.beforeEach(async ({ page }) => {
  await page.goto('#/ui-kit')
})

test('family catalog fixture: parent enables practice and student can open it', async ({ page }) => {
  await page.getByRole('button', { name: 'Список олимпиад' }).click()
  await page.getByText('Олимпиады · 1').click()
  await expect(page.getByText('Подготовка не включена')).toBeVisible()
  await page.getByRole('button', { name: 'Включить подготовку' }).click()
  await expect(page.getByText('Подготовка включена')).toBeVisible()
  await page.getByRole('button', { name: 'Ученик', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть подготовку' }).click()
  await expect(page.getByText('Пример перехода: Подготовка к олимпиаде')).toBeVisible()
})

test('written practice fixture: pupil selects photos and parent sees the request', async ({ page }) => {
  await page.getByRole('button', { name: 'Письменная задача' }).click()
  await page.getByText('№ 1. Письменная задача · пример').click()
  await page.getByText('Нужен ориентир?').click()
  await expect(page.getByRole('button', { name: 'Попросить помощь' })).toBeDisabled()
  await page.getByRole('button', { name: /^Выбрать Фото 1/ }).click()
  await page.getByRole('button', { name: /^Выбрать Фото 2/ }).click()
  await expect(page.getByText('Выбрано фото: 2.', { exact: false })).toBeVisible()
  await page.getByLabel('Вопрос или пояснение (необязательно)').fill('Не понимаю следующий шаг')
  await page.getByRole('button', { name: 'Попросить помощь' }).click()
  await expect(page.getByText('Помощь запрошена')).toBeVisible()
  await page.getByRole('button', { name: 'Родитель', exact: true }).click()
  await expect(page.getByText('Вопрос ученика: Не понимаю следующий шаг')).toBeVisible()
  await expect(page.getByText(/Фото запроса:/)).toBeVisible()
})
