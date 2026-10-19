/** @see ../docs/modules/school-diary/school-calendar.md#представление */
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('keeps the real calendar at its original height and preserves schedule geometry at every supported viewport', { timeout: 60_000 }, () => {
  const output = execFileSync(process.execPath, ['scripts/check-schedule-viewport.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 55_000,
    env: { ...process.env, SCHEDULE_SCREENSHOT_DIR: '' },
  })
  for (const width of [320, 390, 540, 1024, 1600]) for (const font of [16, 20]) {
    expect(output).toContain(`Календарь ${width}px / шрифт ${font}px: высота, размеры и линия дней сохраняются`)
  }
  expect(output).toContain('540px, прошли раскрыты, уроки раскрыты: 8 строк')
})
