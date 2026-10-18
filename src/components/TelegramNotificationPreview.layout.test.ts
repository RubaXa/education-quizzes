import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

/** @see ../../docs/shared/design/telegram.md#визуальная-система */
it('keeps Telegram preview content shrinkable and wraps long text at narrow widths', () => {
  const css = readFileSync(resolve(import.meta.dirname, 'TelegramNotificationPreview.css'), 'utf8')
  const message = css.match(/\.edu-telegram-message\s*\{([^}]*)\}/)?.[1] ?? ''
  const controls = css.match(/\.edu-telegram-controls\s*\{([^}]*)\}/)?.[1] ?? ''
  const primaryContent = css.match(/\.edu-telegram-primary-content\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(message).toContain('min-width:0')
  expect(message).toContain('width:min(100%,520px)')
  expect(controls).toContain('minmax(0,1fr)')
  expect(primaryContent).toContain('overflow-wrap:anywhere')
  expect(primaryContent).toContain('word-break:break-word')
  expect(css).toContain('@media(max-width:420px)')
})
