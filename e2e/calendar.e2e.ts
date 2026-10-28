// @see ../docs/modules/school-diary/school-calendar.md#представление
// @see ../docs/decisions/calendar-scroll-selection-2026-10-28.md
import { expect, test } from '@playwright/test'

function addDays(date: string, amount: number) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + amount)
  return result.toISOString().slice(0, 10)
}

for (const role of ['parent', 'student'] as const) {
  for (const restored of [false, true]) test(`${role}: ${restored ? 'restored' : 'fresh'} load, stable selection, and smooth edge scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    if (restored) await page.addInitScript(() => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      const selected = new Date(`${today}T12:00:00Z`)
      selected.setUTCDate(selected.getUTCDate() + 14)
      sessionStorage.setItem('education-dashboard-selection-day', today)
      sessionStorage.setItem('education-dashboard-selected-date', selected.toISOString().slice(0, 10))
    })
    await page.goto(`e2e/calendar.html?role=${role}`)
    await expect(page.getByRole('heading', { name: 'Выберите день' })).toBeVisible()
    await expect(page.locator('.day-dashboard-kicker')).toContainText(role === 'parent' ? 'Панель родителя' : 'Мой план')

    const strip = page.locator('.day-dashboard-dates')
    const selected = strip.locator('[aria-pressed="true"]')
    const selectedDate = await selected.getAttribute('data-date')
    expect(selectedDate).toBeTruthy()
    if (restored) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      expect(selectedDate).toBe(addDays(today, 14))
    } else await expect(selected).toHaveAttribute('aria-current', 'date')
    const initial = await page.evaluate(() => {
      const stripElement = document.querySelector<HTMLElement>('.day-dashboard-dates')!
      const card = stripElement.querySelector<HTMLElement>('[aria-pressed="true"]')!
      const a = stripElement.getBoundingClientRect()
      const b = card.getBoundingClientRect()
      return { stripLeft: stripElement.scrollLeft, centerDelta: Math.abs((b.left + b.width / 2) - (a.left + a.width / 2)) }
    })
    expect(initial.stripLeft).toBeGreaterThan(0)
    expect(initial.centerDelta).toBeLessThanOrEqual(2)

    const adjacent = strip.locator(`[data-date="${addDays(selectedDate!, 1)}"]`)
    await adjacent.click()
    await expect(adjacent).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => strip.evaluate((element: HTMLElement) => element.scrollLeft)).toBe(initial.stripLeft)

    const edge = strip.locator(`[data-date="${addDays(selectedDate!, 7)}"]`)
    await expect(edge).toBeVisible()
    await edge.click()
    await expect(edge).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => page.evaluate(() => {
      const stripElement = document.querySelector<HTMLElement>('.day-dashboard-dates')!
      const card = stripElement.querySelector<HTMLElement>('[aria-pressed="true"]')!
      const a = stripElement.getBoundingClientRect()
      const b = card.getBoundingClientRect()
      return Math.abs((b.left + b.width / 2) - (a.left + a.width / 2))
    }), { timeout: 3_000 }).toBeLessThanOrEqual(2)
    const finalScrollLeft = await strip.evaluate((element: HTMLElement) => element.scrollLeft)
    expect(finalScrollLeft).toBeGreaterThan(initial.stripLeft)
  })
}
