/** @see ../docs/shared/design/ui-kit.md#иконки-файлов */
import { expect, test } from '@playwright/test'
for (const width of [320, 390, 540, 1280]) {
  test(`shared file icon catalog fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:1000})
    await page.goto('#/ui-kit')
    await page.getByRole('button',{name:'Файлы и превью',exact:true}).click()
    const section=page.getByRole('region',{name:'Файлы и превью',exact:true})
    await expect(section.locator('.edu-kit-file-families .work-file-preview')).toHaveCount(6)
    await expect(section.locator('.edu-kit-file-formats button')).toHaveCount(19)
    await section.getByRole('button',{name:'Показать XLSX',exact:true}).click()
    await expect(section.locator('.edu-kit-file-expanded strong')).toHaveText('Пример.xlsx')
    await expect(section.locator('.edu-kit-file-expanded .lucide-file-spreadsheet')).toBeVisible()
    expect(await section.evaluate(node=>node.scrollWidth>node.clientWidth+1)).toBe(false)
    await section.getByRole('button',{name:'Показать PDF',exact:true}).click()
    await expect(section.locator('.edu-kit-file-expanded strong')).toHaveText('Пример.pdf')
    await section.getByRole('button',{name:'Показать PNG',exact:true}).click()
    const image=section.locator('.edu-kit-file-expanded img')
    await expect(image).toBeVisible()
    await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(section.locator('.edu-kit-file-expanded .work-file-format')).toHaveCount(0)
    await expect(section.locator('.lucide-camera')).toHaveCount(0)
    await section.screenshot({path:`.local/file-icons-${width}.png`})
  })
}

for (const width of [320, 390, 540]) {
  test(`attachment extensions stay whole in both task layouts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('#/ui-kit')
    await page.getByRole('button', { name: 'Файлы и превью', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
    const example = page.getByRole('region', { name: 'Вложения в карточке задания', exact: true })
    for (const layout of ['Карточка дня', 'Выходной лист']) {
      await example.getByRole('button', { name: layout, exact: true }).click()
      const card = example.locator('.problem-card')
      if (!await card.evaluate(node => (node as HTMLDetailsElement).open)) await card.locator(':scope > summary').click()
      for (const role of ['Ученик', 'Родитель']) {
        await example.getByRole('button', { name: role, exact: true }).click()
        for (const extension of ['PDF', 'DOCX']) {
          const label = example.locator('.day-upload-strip .work-file-format').filter({ hasText: new RegExp(`^${extension}$`) })
          await expect(label).toBeVisible()
          const geometry = await label.evaluate(node => {
            const range = document.createRange(); range.selectNodeContents(node)
            const lines = Array.from(range.getClientRects())
            const bounds = node.closest('.artifact-avatar-image')!.getBoundingClientRect()
            const badge = node.closest('.artifact-avatar')!.querySelector('.artifact-avatar-indicator')!.getBoundingClientRect()
            return { lines: lines.length, inside: lines.every(rect => rect.left >= bounds.left && rect.right <= bounds.right), fits: node.scrollWidth <= node.clientWidth, clearsStatus: lines.every(rect => rect.right <= badge.left || rect.bottom <= badge.top) }
          })
          expect(geometry, `${layout}, ${role}, ${extension}`).toEqual({ lines: 1, inside: true, fits: true, clearsStatus: true })
        }
        await example.locator('.day-upload-chip').first().click()
        const photo = example.locator('.day-upload-expanded img')
        await expect(photo).toBeVisible()
        await expect.poll(() => photo.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
        await example.locator('.day-upload-close').click()
        await expect(photo).toHaveCount(0)
      }
    }
  })
}
