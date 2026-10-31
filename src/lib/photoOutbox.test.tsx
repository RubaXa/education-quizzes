// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  docs: new Map<string, Record<string, any>>(),
  events: [] as Array<{ eventId: string; eventType: string; operationId: string }>,
  writes: [] as Array<{ path: string; value: Record<string, any> }>,
  fetch: vi.fn(),
  errors: [] as string[],
  nextReadError: undefined as Error | undefined,
  photoTraces: [] as unknown[][],
}))

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDocFromServer: async (ref: { path: string }) => {
    if (harness.nextReadError) {
      const cause = harness.nextReadError
      harness.nextReadError = undefined
      throw cause
    }
    const value = harness.docs.get(ref.path)
    return { exists: () => Boolean(value), data: () => value }
  },
  writeBatch: () => {
    const writes: Array<{ path: string; value: Record<string, any> }> = []
    return {
      update: (ref: { path: string }, value: Record<string, any>) => writes.push({ path: ref.path, value }),
      commit: async () => {
        harness.writes.push(...writes)
        for (const write of writes) harness.docs.set(write.path, { ...harness.docs.get(write.path), ...write.value })
      },
    }
  },
}))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'student-device' } }) }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./browserAccessTrace', () => ({ tracePhotoStorage: (...args: unknown[]) => harness.photoTraces.push(args) }))
vi.mock('./educationEventProducer', () => ({
  prepareEducationEvent: async (input: { operationId: string }) => ({ ...input, eventId: 'e'.repeat(64) }),
  stagePreparedEducationEvent: (_batch: unknown, event: { eventId: string; eventType: string; operationId: string }) => harness.events.push(event),
}))
vi.mock('./networkRetry', () => ({ fetchWithRetry: (...args: unknown[]) => harness.fetch(...args) }))
vi.mock('./uiErrors', () => ({ reportUiError: (cause: unknown) => { if (cause instanceof Error) harness.errors.push(cause.message); return cause instanceof Error
  && /^(?:Яндекс.Диск отклонил файл: HTTP \d+\.|Ссылка загрузки устарела\.)/.test(cause.message)
  ? cause.message : 'Действие не выполнено. Повторите попытку.' } }))

import WorkPhotoGallery from '../components/WorkPhotoGallery'
import { getPhotoTransferUiSnapshot, localPhotoForTransfer, removePhotoFromOutbox, resumePhotoTransfer, retryPhotoTransfer, savePhotoForTransfer } from './photoOutbox'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const studentToken = 'day-token'
const uploadId = 'photo-1234567890'
const sourcePath = `dayUploads/${studentToken}/files/${uploadId}`
const sourceKey = `${studentToken}:${uploadId}`
const ownerPath = `dayOwners/${studentToken}`
const blob = { size: 20, type: 'image/jpeg', marker: 'original-photo-bytes' } as unknown as Blob & { marker: string }
const requested = () => ({ status: 'awaiting-upload', upload: { href: 'https://uploader.yandex.net/photo-link', issuedAt: 1 },
  taskId: 'task-1', deviceUid: 'student-device' })

async function clearOutbox() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('education-photo-outbox-v1')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}

function injectOpenFailureOnce(cause: DOMException) {
  const originalOpen = indexedDB.open.bind(indexedDB)
  let calls = 0
  vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
    calls += 1
    if (calls > 1) return originalOpen(name, version)
    const request = { error: cause } as unknown as IDBOpenDBRequest
    queueMicrotask(() => request.onerror?.call(request, new Event('error')))
    return request
  }) as typeof indexedDB.open)
  return () => calls
}

function injectFakeDatabaseOnce(database: IDBDatabase) {
  const originalOpen = indexedDB.open.bind(indexedDB)
  let calls = 0
  vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
    calls += 1
    if (calls > 1) return originalOpen(name, version)
    const request: Partial<IDBOpenDBRequest> = { result: database }
    queueMicrotask(() => request.onsuccess?.call(request as IDBOpenDBRequest, new Event('success')))
    return request as IDBOpenDBRequest
  }) as typeof indexedDB.open)
  return () => calls
}

describe('photo transfer recovery', () => {
  afterEach(() => vi.restoreAllMocks())

  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await clearOutbox()
    await removePhotoFromOutbox(studentToken, uploadId)
    harness.docs.clear()
    harness.events.length = 0
    harness.writes.length = 0
    harness.errors.length = 0
    harness.nextReadError = undefined
    harness.photoTraces.length = 0
    harness.fetch.mockReset()
    harness.docs.set(sourcePath, requested())
    harness.docs.set(ownerPath, { familyId: 'family-1', childId: 'child-1' })
  })

  it.each([
    ['UnknownError', 'Connection to Indexed Database server lost. Refresh the page to try again.'],
    ['InvalidStateError', 'The IndexedDB connection is closing.'],
    ['AbortError', 'The IndexedDB open request was aborted.'],
  ])('reopens after a transient %s open failure and preserves the same upload blob', async (name, message) => {
    const openCalls = injectOpenFailureOnce(new DOMException(message, name))
    await savePhotoForTransfer(studentToken, uploadId, blob)
    expect(openCalls()).toBe(2)
    await expect(localPhotoForTransfer(studentToken, uploadId)).resolves.toMatchObject({
      size: blob.size, type: blob.type, marker: blob.marker,
    })
    expect(openCalls()).toBe(3)
    expect(harness.photoTraces).toContainEqual(expect.arrayContaining(['savePhotoForTransfer', 'retrying', name === 'UnknownError' ? 'indexeddb-connection-lost' : name === 'InvalidStateError' ? 'invalid-state' : 'abort', 1]))
    expect(JSON.stringify(harness.photoTraces)).not.toContain(uploadId)
    expect(JSON.stringify(harness.photoTraces)).not.toContain('original-photo-bytes')
  })

  it('reopens after transaction creation throws InvalidStateError and closes the failed connection', async () => {
    await savePhotoForTransfer(studentToken, uploadId, blob)
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => { throw new DOMException('connection closed', 'InvalidStateError') },
      addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn(),
    } as unknown as IDBDatabase
    const openCalls = injectFakeDatabaseOnce(database)
    await expect(localPhotoForTransfer(studentToken, uploadId)).resolves.toMatchObject({ marker: blob.marker })
    expect(openCalls()).toBe(2)
    expect(database.close).toHaveBeenCalledOnce()
  })

  it.each(['abort', 'close'] as const)('reopens when the IndexedDB connection emits %s before transaction completion', async (failureMode) => {
    await savePhotoForTransfer(studentToken, uploadId, blob)
    let closeListener: EventListener | undefined
    const transaction: Partial<IDBTransaction> = {
      error: new DOMException(`connection ${failureMode}`, failureMode === 'abort' ? 'AbortError' : 'UnknownError'),
      objectStore: () => ({ get: () => ({}) } as unknown as IDBObjectStore),
    }
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        queueMicrotask(() => {
          if (failureMode === 'abort') transaction.onabort?.call(transaction as IDBTransaction, new Event('abort'))
          else closeListener?.(new Event('close'))
        })
        return transaction as IDBTransaction
      },
      addEventListener: (_type: string, listener: EventListener) => { closeListener = listener },
      removeEventListener: vi.fn(), close: vi.fn(),
    } as unknown as IDBDatabase
    const openCalls = injectFakeDatabaseOnce(database)
    await expect(localPhotoForTransfer(studentToken, uploadId)).resolves.toMatchObject({ marker: blob.marker })
    expect(openCalls()).toBe(2)
    expect(database.close).toHaveBeenCalledOnce()
  })

  it.each([
    ['QuotaExceededError', 'no storage space'],
    ['SecurityError', 'Connection to Indexed Database server lost'],
    ['DataError', 'invalid stored data'],
  ])('does not retry non-transient %s storage failures', async (name, message) => {
    const openCalls = injectOpenFailureOnce(new DOMException(message, name))
    await expect(savePhotoForTransfer(studentToken, uploadId, blob)).rejects.toThrow(/Не удалось сохранить файл на этом устройстве/)
    expect(openCalls()).toBe(1)
  })

  it('times out a stuck open request after a bounded reconnect attempt', async () => {
    vi.useFakeTimers()
    let openCalls = 0
    vi.spyOn(indexedDB, 'open').mockImplementation((() => {
      openCalls += 1
      return {} as IDBOpenDBRequest
    }) as typeof indexedDB.open)
    try {
      const pending = savePhotoForTransfer(studentToken, uploadId, blob)
      const rejected = expect(pending).rejects.toThrow(/Не удалось сохранить файл на этом устройстве/)
      await vi.advanceTimersByTimeAsync(12_100)
      await rejected
      expect(openCalls).toBe(2)
    } finally { vi.useRealTimers() }
  })

  it('aborts and closes a stuck live read transaction before reopening; a late completion cannot replace its result', async () => {
    await savePhotoForTransfer(studentToken, uploadId, blob)
    vi.useFakeTimers()
    let openCalls = 0
    const firstRequest = { result: { id: sourceKey, file: { marker: 'late-result' } } } as unknown as IDBRequest
    const secondRequest = { result: { id: sourceKey, file: { marker: 'reopened-result' } } } as unknown as IDBRequest
    const firstTransaction: Partial<IDBTransaction> = {
      objectStore: () => ({ get: () => firstRequest } as unknown as IDBObjectStore),
      abort: vi.fn(),
    }
    const secondTransaction: Partial<IDBTransaction> = {
      objectStore: () => {
        queueMicrotask(() => {
          secondRequest.onsuccess?.call(secondRequest, new Event('success'))
          secondTransaction.oncomplete?.call(secondTransaction as IDBTransaction, new Event('complete'))
        })
        return { get: () => secondRequest } as unknown as IDBObjectStore
      },
    }
    const firstClose = vi.fn(), secondClose = vi.fn()
    const firstDatabase = { transaction: () => firstTransaction, addEventListener: vi.fn(), removeEventListener: vi.fn(), close: firstClose } as unknown as IDBDatabase
    const secondDatabase = { transaction: () => secondTransaction, addEventListener: vi.fn(), removeEventListener: vi.fn(), close: secondClose } as unknown as IDBDatabase
    const openRequest = (database: IDBDatabase) => {
      const request = { result: database } as unknown as IDBOpenDBRequest
      queueMicrotask(() => request.onsuccess?.call(request, new Event('success')))
      return request
    }
    vi.spyOn(indexedDB, 'open').mockImplementation((() => {
      openCalls += 1
      return openRequest(openCalls === 1 ? firstDatabase : secondDatabase)
    }) as typeof indexedDB.open)
    try {
      const pending = localPhotoForTransfer(studentToken, uploadId)
      await vi.advanceTimersByTimeAsync(6_100)
      const recovered = await pending
      expect(recovered).toMatchObject({ marker: 'reopened-result' })
      expect(openCalls).toBe(2)
      expect(firstTransaction.abort).toHaveBeenCalledOnce()
      expect(firstClose).toHaveBeenCalledOnce()
      expect(secondClose).toHaveBeenCalledOnce()

      firstRequest.onsuccess?.call(firstRequest, new Event('success'))
      firstTransaction.oncomplete?.call(firstTransaction as IDBTransaction, new Event('complete'))
      expect(recovered).toMatchObject({ marker: 'reopened-result' })
      expect(firstClose).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('recovers an aborted local read before PUT, then uploads the same saved blob', async () => {
    await savePhotoForTransfer(studentToken, uploadId, blob)
    harness.fetch.mockResolvedValueOnce({ ok: true, status: 201 })
    const transaction: Partial<IDBTransaction> = {
      objectStore: () => ({ get: () => ({}) } as unknown as IDBObjectStore),
      abort: vi.fn(),
    }
    const database = {
      transaction: () => {
        queueMicrotask(() => transaction.onabort?.call(transaction as IDBTransaction, new Event('abort')))
        return transaction
      },
      addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn(),
    } as unknown as IDBDatabase
    const openCalls = injectFakeDatabaseOnce(database)

    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(harness.events).toHaveLength(1))

    expect(openCalls()).toBe(2)
    expect(database.close).toHaveBeenCalledOnce()
    expect(harness.fetch).toHaveBeenCalledOnce()
    expect(harness.fetch.mock.calls[0]?.[1]).toMatchObject({ body: expect.objectContaining({ marker: blob.marker }) })
    expect(harness.docs.get(sourcePath)?.status).toBe('uploaded')
  })

  it('aborts an upgrade that arrives after its open request timed out', async () => {
    vi.useFakeTimers()
    const openRequests: IDBOpenDBRequest[] = []
    const transactions: Array<{ abort: ReturnType<typeof vi.fn> }> = []
    const createObjectStore = vi.fn()
    vi.spyOn(indexedDB, 'open').mockImplementation((() => {
      const transaction = { abort: vi.fn() }
      transactions.push(transaction)
      const database = { objectStoreNames: { contains: () => false }, createObjectStore }
      const request = { result: database, transaction } as unknown as IDBOpenDBRequest
      openRequests.push(request)
      return request
    }) as typeof indexedDB.open)
    try {
      const pending = savePhotoForTransfer(studentToken, uploadId, blob)
      const rejected = expect(pending).rejects.toThrow(/Не удалось сохранить файл на этом устройстве/)
      await vi.advanceTimersByTimeAsync(12_100)
      await rejected
      expect(openRequests).toHaveLength(2)
      openRequests[0].onupgradeneeded?.call(openRequests[0], new Event('upgradeneeded') as IDBVersionChangeEvent)
      expect(transactions[0].abort).toHaveBeenCalledOnce()
      expect(createObjectStore).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('shows a rejected PUT beside its existing photo and retries the same blob and upload ID', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    harness.fetch.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 201 })
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(getPhotoTransferUiSnapshot().get(sourceKey)?.phase).toBe('failed'))
    expect(harness.errors).toEqual(['Яндекс.Диск отклонил файл: HTTP 503.'])

    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(createElement(WorkPhotoGallery, { taskTitle: 'Упражнение', studentToken,
        uploads: [{ id: sourceKey, taskId: 'task-1', status: 'awaiting-upload' }],
        localPhotos: [{ id: uploadId, taskId: 'task-1', previewUrl: 'blob:photo', state: 'saved' }], now: Date.now() })))
      expect(host.textContent).toContain('1 не загрузилось')
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
      expect(host.querySelector('.day-upload-expanded')?.textContent).toContain('Яндекс.Диск отклонил файл: HTTP 503.')
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('Яндекс.Диск отклонил файл: HTTP 503.')
      expect(host.querySelector('.day-upload-retry')?.textContent).toContain('Повторить передачу')
      await act(async () => {
        host.querySelector<HTMLButtonElement>('.day-upload-retry')!.click()
        await vi.waitFor(() => expect(harness.docs.get(sourcePath)?.status).toBe('uploaded'))
      })
      expect(harness.fetch).toHaveBeenCalledTimes(2)
      expect(harness.fetch.mock.calls.map((call) => call[0])).toEqual([
        'https://uploader.yandex.net/photo-link', 'https://uploader.yandex.net/photo-link',
      ])
      expect(harness.fetch.mock.calls[0][1].body).toMatchObject({ size: blob.size, type: blob.type, marker: blob.marker })
      expect(harness.fetch.mock.calls[1][1].body).toMatchObject({ size: blob.size, type: blob.type, marker: blob.marker })
      expect(harness.events).toHaveLength(1)
      expect(harness.events[0]).toMatchObject({ eventType: 'upload.bytes_uploaded', operationId: `upload-transfer:${uploadId}:uploaded` })
      expect(harness.writes[0].value.status).toBe('uploaded')
    } finally { await act(async () => root.unmount()) }
  })

  it('coalesces simultaneous resumes and sends one PUT', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    let finish!: (value: { ok: boolean; status: number }) => void
    harness.fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    resumePhotoTransfer(studentToken, uploadId, requested())
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1))
    finish({ ok: true, status: 201 })
    await vi.waitFor(() => expect(harness.docs.get(sourcePath)?.status).toBe('uploaded'))
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(harness.events).toHaveLength(1)
  })

  it('wakes a failed known transfer on reconnect without another Firestore listener', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    harness.fetch.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 201 })
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(getPhotoTransferUiSnapshot().get(sourceKey)?.phase).toBe('failed'))
    act(() => window.dispatchEvent(new Event('online')))
    await vi.waitFor(() => expect(harness.docs.get(sourcePath)?.status).toBe('uploaded'))
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    expect(harness.events).toHaveLength(1)
  })

  it('refreshes a stale known link from the server on wake and retries the newest href once', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    harness.fetch.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 201 })
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(getPhotoTransferUiSnapshot().get(sourceKey)?.phase).toBe('failed'))
    const newer = { ...requested(), upload: { href: 'https://uploader.yandex.net/refreshed-link', issuedAt: 2 } }
    harness.docs.set(sourcePath, newer)
    act(() => window.dispatchEvent(new Event('online')))
    await vi.waitFor(() => expect(harness.docs.get(sourcePath)?.status).toBe('uploaded'))
    expect(harness.fetch.mock.calls.map((call) => call[0])).toEqual([
      'https://uploader.yandex.net/photo-link', 'https://uploader.yandex.net/refreshed-link',
    ])
    expect(harness.events).toHaveLength(1)
  })

  it('defers an online wake during an active PUT and consumes it for one retry only', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    let reject!: (cause: Error) => void
    harness.fetch.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
      .mockResolvedValueOnce({ ok: false, status: 503 })
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1))
    act(() => window.dispatchEvent(new Event('online')))
    reject(new Error('Яндекс.Диск отклонил файл: HTTP 503.'))
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(getPhotoTransferUiSnapshot().get(sourceKey)?.phase).toBe('failed'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    expect(harness.events).toHaveLength(0)
  })

  it('does not mark another device failed when its local blob is absent; explains only on manual retry', async () => {
    harness.docs.set(sourcePath, { ...requested(), deviceUid: 'other-device' })
    resumePhotoTransfer(studentToken, uploadId, { ...requested(), deviceUid: 'other-device' })
    await vi.waitFor(() => expect(harness.fetch).not.toHaveBeenCalled())
    expect(getPhotoTransferUiSnapshot().has(sourceKey)).toBe(false)
    await expect(retryPhotoTransfer(studentToken, uploadId)).rejects.toThrow(/устройстве, где выбрали файл/)
    const transferError = getPhotoTransferUiSnapshot().get(sourceKey)
    expect(transferError?.phase).toBe('failed')
    if (transferError?.phase === 'failed') expect(transferError.message).toContain('Откройте эту страницу на устройстве')
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.docs.get(sourcePath)?.status).toBe('awaiting-upload')
  })

  it('shows a local retry error when the explicit source refresh itself fails', async () => {
    harness.nextReadError = new Error('network offline')
    await expect(retryPhotoTransfer(studentToken, uploadId)).rejects.toThrow('network offline')
    const localError = getPhotoTransferUiSnapshot().get(sourceKey)
    expect(localError).toMatchObject({ phase: 'failed', message: 'Действие не выполнено. Повторите попытку.' })
    if (localError?.phase === 'failed') expect(localError.message).toBe('Действие не выполнено. Повторите попытку.')
    expect(harness.writes).toHaveLength(0)
    expect(harness.events).toHaveLength(0)
    expect(harness.fetch).not.toHaveBeenCalled()
  })

  it('shows the safe local read error when IndexedDB remains unavailable before PUT', async () => {
    let openCalls = 0
    vi.spyOn(indexedDB, 'open').mockImplementation((() => {
      openCalls += 1
      const request = { error: new DOMException('Connection to Indexed Database server lost.', 'SecurityError') } as unknown as IDBOpenDBRequest
      queueMicrotask(() => request.onerror?.call(request, new Event('error')))
      return request
    }) as typeof indexedDB.open)
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(getPhotoTransferUiSnapshot().get(sourceKey)?.phase).toBe('failed'))
    const transferError = getPhotoTransferUiSnapshot().get(sourceKey)
    expect(transferError?.phase).toBe('failed')
    if (transferError?.phase === 'failed') {
      expect(transferError.message).toBe('Не удалось прочитать сохранённый файл на этом устройстве. Оставьте страницу открытой и повторите передачу.')
    }
    expect(openCalls).toBe(1)
    expect(harness.errors).toHaveLength(0)
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.writes).toHaveLength(0)
    expect(harness.events).toHaveLength(0)
    expect(harness.docs.get(sourcePath)?.status).toBe('awaiting-upload')
  })

  it('runs a newly issued href once after an older PUT finishes, but stops when the source becomes terminal', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    let finish!: (value: { ok: boolean; status: number }) => void
    harness.fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce({ ok: true, status: 201 })
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1))
    const hrefB = 'https://uploader.yandex.net/refreshed-link'
    const newer = { ...requested(), upload: { href: hrefB, issuedAt: 2 } }
    harness.docs.set(sourcePath, newer)
    resumePhotoTransfer(studentToken, uploadId, newer)
    finish({ ok: true, status: 201 })
    await vi.waitFor(() => expect(harness.docs.get(sourcePath)?.status).toBe('uploaded'))
    expect(harness.fetch.mock.calls.map((call) => call[0])).toEqual(['https://uploader.yandex.net/photo-link', hrefB])
    expect(harness.events).toHaveLength(1)
  })

  it('does not retry or emit bytes when the source becomes pending during an active PUT', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    let finish!: (value: { ok: boolean; status: number }) => void
    harness.fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1))

    const pending = { ...requested(), status: 'pending' }
    harness.docs.set(sourcePath, pending)
    resumePhotoTransfer(studentToken, uploadId, pending)
    finish({ ok: true, status: 201 })
    await vi.waitFor(() => expect(getPhotoTransferUiSnapshot().has(sourceKey)).toBe(false))
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(harness.events).toHaveLength(0)
    expect(harness.docs.get(sourcePath)?.status).toBe('pending')
  })

  it('does not show a late PUT failure after the source has already become pending', async () => {
    const { savePhotoForTransfer } = await import('./photoOutbox')
    await savePhotoForTransfer(studentToken, uploadId, blob)
    let reject!: (cause: Error) => void
    harness.fetch.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
    resumePhotoTransfer(studentToken, uploadId, requested())
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1))

    const pending = { ...requested(), status: 'pending' }
    harness.docs.set(sourcePath, pending)
    reject(new Error('Яндекс.Диск отклонил файл: HTTP 503.'))
    await vi.waitFor(() => expect(getPhotoTransferUiSnapshot().has(sourceKey)).toBe(false))
    expect(harness.errors).toHaveLength(0)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(harness.events).toHaveLength(0)
  })
})
