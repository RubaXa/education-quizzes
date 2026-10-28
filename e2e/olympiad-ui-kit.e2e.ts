import { expect, test } from '@playwright/test'

// UI Kit uses synthetic role projections and never writes to a family account.
test.beforeEach(async ({ page }) => {
  await page.goto('#/ui-kit')
})

test('family catalog fixture: parent enables practice and student can open it', async ({ page }) => {
  await page.getByRole('button', { name: 'Список олимпиад' }).click()
  await page.getByRole('tab', { name: 'Доступные 2' }).click()
  const toggle = page.getByRole('switch', { name: 'Подготовка: Формула Единства / Третье тысячелетие · пример' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(page.getByRole('tab', { name: 'Активные 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Ученик', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть олимпиаду «Формула Единства / Третье тысячелетие · пример»' }).click()
  await expect(page.getByText('Пример перехода: Формула Единства')).toBeVisible()
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

for (const width of [320, 375, 390, 430]) {
  test(`olympiad tabs fit and both cards open independently at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.getByRole('button', { name: 'Список олимпиад' }).click()
    const tabs = page.getByRole('tablist', { name: 'Олимпиады' })
    const bounds = await tabs.getByRole('tab').evaluateAll(nodes => nodes.map(node => { const r=node.getBoundingClientRect(); return { top:r.top, left:r.left, right:r.right, overflow:node.scrollWidth > node.clientWidth } }))
    expect(bounds).toHaveLength(3)
    expect(Math.max(...bounds.map(x => x.top)) - Math.min(...bounds.map(x => x.top))).toBeLessThan(2)
    expect(bounds.every(x => x.left >= 0 && x.right <= width && !x.overflow)).toBe(true)
    await page.getByRole('tab', { name:'Доступные 2' }).click()
    await page.getByRole('switch', { name:'Подготовка: Формула Единства / Третье тысячелетие · пример' }).click()
    await page.getByRole('switch', { name:'Подготовка: Надежда энергетики · пример' }).click()
    await page.getByRole('tab', { name:'Активные 2' }).click()
    await page.getByRole('button', { name:'Открыть олимпиаду «Надежда энергетики · пример»' }).click()
    await expect(page.getByText('Пример перехода: Надежда энергетики')).toBeVisible()
    await page.getByRole('button', { name:'Открыть олимпиаду «Формула Единства / Третье тысячелетие · пример»' }).click()
    await expect(page.getByText('Пример перехода: Формула Единства')).toBeVisible()
  })
}

test('olympiad practice fixture shows its problems before expanding the group', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 820 })
  await page.getByRole('button', { name: 'Письменная задача' }).click()
  const group = page.getByRole('button', { name: /Свернуть Задачи для практики/ })
  await expect(group).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Условная олимпиадная задача')).toBeVisible()
  await group.click()
  await expect(page.getByRole('button', { name: /Развернуть Задачи для практики/ })).toHaveAttribute('aria-expanded', 'false')
})

test('source queue uses the shared upload and remains visible to the parent', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 820 })
  await page.getByRole('button', { name: 'Страница олимпиады' }).click()
  await page.getByRole('button', { name: 'Ученик', exact: true }).click()
  const queue = page.getByRole('region', { name: 'Свои варианты' })
  await queue.getByText('Загрузить свой вариант').click()
  await queue.locator('input[type=file]').setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: Buffer.from('fixture') })
  await expect(queue.getByText('3 фото')).toBeVisible()
  await expect(queue.getByText(/обработка условий ожидается/)).toBeVisible()
  await page.getByRole('button', { name: 'Родитель', exact: true }).click()
  await expect(queue.getByText('3 фото')).toBeVisible()
  await expect(queue.locator('input[type=file]')).toHaveCount(0)
})

test('energy hope archive exposes the shared 6th grade PDF on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 820 })
  await page.getByRole('button', { name: 'Страница олимпиады' }).click()
  const archive = page.getByRole('region', { name: 'Олимпиада и архив' })
  await archive.getByText('Задания прошлых лет · 6 класс').click()
  const link = archive.getByRole('link', { name: '2024/25 · заключительный этап · PDF ↗' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /^https:\/\/(disk\.yandex\.ru|disk\.yandex\.com|yadi\.sk)\//)
})

test('olympiad quiz shows its topic and full reading for both roles on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 820 })
  await page.getByRole('button', { name: 'Страница олимпиады' }).click()
  for (const role of ['Родитель', 'Ученик']) {
    await page.getByRole('button', { name: role, exact: true }).click()
    const card = page.getByRole('region', { name: 'Тест: Чётность и сумма' })
    await expect(card).toBeVisible()
    await expect(card.getByText(/Чётное число делится на 2/)).toBeVisible()
    await expect(card.getByText(/5 \+ 7 = 12/)).toBeVisible()
    const bounds = await card.evaluate(el => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client)
  }
})
