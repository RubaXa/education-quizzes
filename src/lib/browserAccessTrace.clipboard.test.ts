// @vitest-environment jsdom
/** @see ../../docs/modules/families/browser-access-trace.md */
import { afterEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear() })
it('copies the complete safe receipt, including delayed identity fingerprints, through writeText', async () => {
  vi.resetModules(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('ClipboardItem', undefined)
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  localStorage.setItem('education-personal-context-v1', 'PRIVATE_AUTH_CONTEXT')
  const api = await import('./browserAccessTrace')
  api.traceAccessContext('identity.resolved', { source: 'grant-server', role: 'student', atFunction: 'sessionFromGrant', previousState: 'checking', state: 'resolved' }, { personId: 'PRIVATE_PERSON', deviceUid: 'PRIVATE_DEVICE', linkToken: 'PRIVATE_CREDENTIAL' })
  await api.copyAccessDiagnostics()
  const text = writeText.mock.calls[0][0]
  expect(text).not.toMatch(/PRIVATE_PERSON|PRIVATE_DEVICE|PRIVATE_CREDENTIAL/)
  const receipt = JSON.parse(text)
  expect(receipt.events[0].detail).toMatchObject({ person: await api.accessFingerprint('PRIVATE_PERSON'), device: await api.accessFingerprint('PRIVATE_DEVICE'), grant: await api.accessFingerprint('PRIVATE_CREDENTIAL') })
  expect(receipt.complete).toBe(true)
  expect(localStorage.getItem('education-personal-context-v1')).toBe('PRIVATE_AUTH_CONTEXT')
  expect(fetch).not.toHaveBeenCalled()
  localStorage.removeItem('education-personal-context-v1')
})
it('starts ClipboardItem write synchronously within the user gesture before async export finishes', async () => {
  vi.resetModules()
  let content: Promise<Blob> | undefined
  vi.stubGlobal('ClipboardItem', class { constructor(data: Record<string, Promise<Blob>>) { content = data['text/plain'] } })
  const write = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { write } })
  const { copyAccessDiagnostics } = await import('./browserAccessTrace')
  const copying = copyAccessDiagnostics()
  expect(write).toHaveBeenCalledTimes(1)
  expect(content).toBeInstanceOf(Promise)
  expect(await content).toBeInstanceOf(Blob)
  await copying
})
it('copies photo storage diagnostics through the existing export without raw storage errors', async () => {
  vi.resetModules(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('ClipboardItem', undefined)
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const api = await import('./browserAccessTrace')
  api.tracePhotoStorage('savePhotoForTransfer', 'retrying', 'indexeddb-connection-lost', 2, 16)
  await api.copyAccessDiagnostics()
  const text = writeText.mock.calls[0][0]
  expect(text).toContain('photo.storage')
  expect(JSON.parse(text).events[0]).toMatchObject({ event: 'photo.storage', detail: {
    atFunction: 'savePhotoForTransfer', state: 'retrying', code: 'indexeddb-connection-lost', count: 2, durationMs: 16,
  } })
  expect(text).not.toMatch(/UnknownError|PRIVATE_PATH|PRIVATE_PHOTO_ID|PRIVATE_BLOB/)
})
