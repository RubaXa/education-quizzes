/** @see ../../docs/product/ui-change-control.md#photo-interactions */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps the close button above the positioned image surface', () => {
  const css = readFileSync('src/components/WorkPhotoGallery.css', 'utf8')
  const close = css.match(/\.day-upload-close\{([^}]+)\}/)?.[1] ?? ''
  expect(close).toContain('position:absolute')
  expect(Number(close.match(/z-index:(\d+)/)?.[1] ?? 0)).toBeGreaterThan(0)
})
