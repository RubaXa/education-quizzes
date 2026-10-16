// @vitest-environment jsdom
// @see ../../docs/modules/school-diary/dashboard.md#dashboard-warm-start
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useDelayedRefresh } from './useDelayedRefresh'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe({ active }: { active: boolean }) {
  return <output>{useDelayedRefresh(active) ? 'refreshing' : 'quiet'}</output>
}

afterEach(() => vi.useRealTimers())

it('keeps a 300 ms refresh invisible and shows one icon only for a longer refresh', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<Probe active />) })
  expect(host.textContent).toBe('quiet')
  await act(async () => { vi.advanceTimersByTime(300) })
  expect(host.textContent).toBe('quiet')
  await act(async () => { vi.advanceTimersByTime(150) })
  expect(host.textContent).toBe('refreshing')
  await act(async () => { root.render(<Probe active={false} />) })
  expect(host.textContent).toBe('quiet')
  await act(async () => { root.unmount() }); host.remove()
})
