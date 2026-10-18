// @vitest-environment jsdom
/** @see ../../docs/modules/families/browser-access-trace.md */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
const scene = vi.hoisted(() => ({ copy: vi.fn() }))
vi.mock('@/lib/browserAccessTrace', () => ({ copyAccessDiagnostics: scene.copy }))
import { DiagnosticsCopyButton } from './DiagnosticsCopyButton'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { scene.copy.mockReset() })
it('keeps the copy control in the shared header on every route with mobile wrapping', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  const css = readFileSync('src/App.css', 'utf8')
  expect(app).toContain('<div className="notification-bell-slot"><DiagnosticsCopyButton /><NotificationBell')
  expect(css).toMatch(/\.site-header\s*\{[^}]*flex-wrap:wrap/)
})
it('copies a complete diagnostic receipt with one click and keeps the bug icon', async () => {
  scene.copy.mockResolvedValue(undefined)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<DiagnosticsCopyButton />))
    const button = host.querySelector('button')!
    expect(button.textContent).toContain('🐞')
    expect(button.getAttribute('aria-label')).toBe('Скопировать логи диагностики')
    await act(async () => button.click())
    expect(scene.copy).toHaveBeenCalledTimes(1)
    expect(button.textContent).toContain('🐞')
    expect(host.querySelector('[role=status]')?.textContent).toContain('Логи скопированы')
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('reports a clipboard failure without claiming that logs were copied', async () => {
  scene.copy.mockRejectedValue(new Error('Permission denied'))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<DiagnosticsCopyButton />))
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelector('[role=status]')?.textContent).toContain('Не удалось скопировать')
    expect(host.querySelector('[role=status]')?.textContent).not.toContain('Permission denied')
  } finally { await act(async () => root.unmount()); host.remove() }
})
