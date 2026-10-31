/** @see ../docs/shared/media-storage.md#форматы-решений */
import { expect, test } from '@playwright/test'
for (const width of [320, 390, 540]) {
  test(`mixed solution files keep icons, opening and both roles at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('#/ui-kit')
    await page.getByRole('button', { name: 'Письменная задача', exact: true }).click()
    await page.getByText('№ 1. Письменная задача · пример', { exact: true }).click()
    const card = page.locator('#demo-written')
    await card.locator('.problem-card-actions input').setInputFiles([
      { name: 'Решение-подробное.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nfixture') },
      { name: 'Решение.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('fixture') },
      { name: 'Расчёты.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fixture') },
      { name: 'Объяснение.txt', mimeType: 'text/plain', buffer: Buffer.from('Решение') },
    ])
    for (const role of ['Ученик', 'Родитель']) {
      if (role === 'Родитель') await page.getByRole('button', { name: 'Родитель', exact: true }).click()
      await expect(card.locator('.work-file-preview-compact')).toHaveCount(4)
      const input = card.locator('.problem-card-actions input')
      if (role === 'Родитель') await expect(input).toHaveCount(0)
      else await expect(input).toHaveCount(1)
      for (const name of ['Решение-подробное.pdf', 'Решение.docx', 'Расчёты.xlsx', 'Объяснение.txt']) {
        await card.getByRole('button', { name: new RegExp(`^Открыть .*${name.replace('.', '\\.')} ·`) }).click()
        await expect(card.locator('.day-upload-expanded strong')).toHaveText(name)
        await expect(card.locator('.day-upload-expanded img')).toHaveCount(0)
        await expect(card.getByRole('link', { name: 'Открыть файл' })).toHaveAttribute('href', /^blob:/)
        const overflow = await card.locator('.day-upload-expanded').evaluate(node => node.scrollWidth > node.clientWidth + 1)
        expect(overflow).toBe(false)
        await card.getByRole('button', { name: 'Закрыть файл' }).click()
      }
    }
    await card.getByRole('button', { name: /^Открыть PDF/ }).click()
    await page.screenshot({ path: `.local/solution-files-${width}.png`, fullPage: true })
  })
}
