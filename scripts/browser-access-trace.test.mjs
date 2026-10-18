// @vitest-environment jsdom
/** @see ../docs/modules/families/browser-access-trace.md */
import { webcrypto } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { browserTraceSnippet, summarizeReceipt } from './browser-access-trace.mjs'
import { collectBrowserAccessSnapshot } from '../public/access-snapshot.js'
it('collects a secret-free old-build baseline without network, writes, reload or full storage dump', async () => {
  localStorage.setItem('education-personal-context-v1', JSON.stringify({ savedAt: 100, session: { personId: 'person', deviceUid: 'device', linkToken: 'BEARER_SECRET' }, profile: { personId: 'person', displayName: 'PRIVATE_NAME', children: [{ role: 'student', dashboardToken: 'RESOURCE_SECRET' }] } }))
  document.body.innerHTML = '<button>Добавить фото исправления</button><script src="https://example.com/index-OldBundle.js"></script>'
  vi.stubGlobal('crypto', webcrypto)
  window.matchMedia = () => ({ matches: false })
  const output = await collectBrowserAccessSnapshot()
  expect(output).not.toMatch(/BEARER_SECRET|PRIVATE_NAME|RESOURCE_SECRET|personId|deviceUid|linkToken/)
  const receipt = JSON.parse(output)
  expect(receipt.baseline.roles).toEqual(['student'])
  expect(receipt.baseline.studentUpload).toBe(true)
  expect(receipt.baseline.bundles).toEqual(['index-OldBundle.js'])
  expect(receipt.baseline.person).toMatch(/^[a-f0-9]{24}$/)
  expect(summarizeReceipt(receipt).status).toBe('insufficient-evidence')
  expect(localStorage.getItem('education-personal-context-v1')).toContain('BEARER_SECRET')
  expect(browserTraceSnippet).toBe("copy(await import('/education-quizzes/access-snapshot.js?v=1').then(m => m.collectBrowserAccessSnapshot()))")
  vi.unstubAllGlobals()
})
it('does not echo injected receipt strings or accept an arbitrary object as evidence', () => {
  expect(() => summarizeReceipt({})).toThrow()
  const result = summarizeReceipt({ schemaVersion: 1, events: [], baseline: { roles: ['SECRET'], bundles: ['https://secret'], person: 'BEARER' } })
  expect(JSON.stringify(result)).not.toMatch(/SECRET|https|BEARER/)
})
