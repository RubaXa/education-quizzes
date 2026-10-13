// @vitest-environment node
// @see ../../docs/product/design-system.md#shell
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Headless Chrome cannot start in the restricted local runner. Keep the
// viewport contract executable by checking the actual CSS and the boundary
// geometry that clipped the user's 390px iPhone viewport.
const appCss = readFileSync(resolve('src/App.css'), 'utf8')
const bellCss = readFileSync(resolve('src/components/NotificationBell.css'), 'utf8')
const pwaCss = readFileSync(resolve('src/components/PwaControls.css'), 'utf8')

describe('notification shell viewport contract', () => {
  it('keeps the bell as the rightmost mobile header item', () => {
    expect(appCss).toMatch(/@media\s*\(max-width:\s*800px\)[\s\S]*?\.header-note\s*\{[^}]*display:\s*none/)
    expect(appCss).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.notification-bell-slot\s*\{[^}]*margin-left:\s*auto;[^}]*order:\s*2;[^}]*\}/)
    expect(appCss).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.header-actions\s*\{[^}]*order:\s*1;[^}]*\}/)
    expect(pwaCss).toMatch(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.pwa-install\s*\{[^}]*width:\s*var\(--edu-touch-target\)/)
    expect(pwaCss).toMatch(/\.pwa-install span\s*\{[^}]*display:\s*none/)
  })

  it('bounds the panel to the phone viewport even at 320px', () => {
    expect(bellCss).toMatch(/\.notification-panel\s*\{[^}]*right:\s*0;[^}]*width:\s*min\(360px,calc\(100vw - 32px\)\)/)
    for (const viewport of [320, 390, 540, 640]) {
      const headerInset = 16
      const bellRight = viewport - headerInset
      const panelWidth = Math.min(360, viewport - 32)
      expect(bellRight - panelWidth).toBeGreaterThanOrEqual(16)
    }
  })
})
