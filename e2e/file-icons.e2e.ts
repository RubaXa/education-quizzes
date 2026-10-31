/** @see ../docs/shared/design/ui-kit.md#иконки-файлов */
import { expect, test } from '@playwright/test'
for (const width of [320, 390, 540, 1280]) {
  test(`shared file icon catalog fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:1000})
    await page.goto('#/ui-kit')
    await page.getByRole('button',{name:'Иконки файлов',exact:true}).click()
    const section=page.getByRole('region',{name:'Иконки файлов',exact:true})
    await expect(section.locator('.edu-kit-file-families .work-file-preview')).toHaveCount(6)
    await expect(section.locator('.edu-kit-file-formats button')).toHaveCount(19)
    await section.getByRole('button',{name:'Показать XLSX',exact:true}).click()
    await expect(section.locator('.edu-kit-file-expanded strong')).toHaveText('Пример.xlsx')
    await expect(section.locator('.edu-kit-file-expanded .lucide-file-spreadsheet')).toBeVisible()
    expect(await section.evaluate(node=>node.scrollWidth>node.clientWidth+1)).toBe(false)
    await section.getByRole('button',{name:'Показать PDF',exact:true}).click()
    await expect(section.locator('.edu-kit-file-expanded strong')).toHaveText('Пример.pdf')
    await section.screenshot({path:`.local/file-icons-${width}.png`})
  })
}
