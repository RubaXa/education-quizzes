import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEducationEventId } from '../../packages/education-events/envelope.mjs'

const harness = vi.hoisted(() => ({
  docs: new Map<string, Record<string, any>>(),
  batches: [] as Array<Array<{ method: string; path: string; value: Record<string, any> }>>,
  failNextCommitAfterApply: false,
  timestamp: 0,
}))

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  documentId: () => '__name__',
  getDoc: async (ref: { path: string }) => snapshot(ref.path),
  getDocFromServer: async (ref: { path: string }) => snapshot(ref.path),
  getDocs: async () => ({ docs: [] }),
  onSnapshot: () => () => {},
  query: (...parts: unknown[]) => parts,
  serverTimestamp: () => ({ __serverTimestamp: true, sequence: ++harness.timestamp }),
  where: (...parts: unknown[]) => parts,
  writeBatch: () => {
    const writes: Array<{ method: string; path: string; value: Record<string, any> }> = []
    const batch = {
      set: (ref: { path: string }, value: Record<string, any>) => writes.push({ method: 'set', path: ref.path, value }),
      update: (ref: { path: string }, value: Record<string, any>) => writes.push({ method: 'update', path: ref.path, value }),
      commit: async () => {
        harness.batches.push([...writes])
        if (writes.some((write) => write.path.startsWith('educationEvents/') && harness.docs.has(write.path))) {
          throw new Error('already-exists')
        }
        for (const write of writes) {
          const current = harness.docs.get(write.path) ?? {}
          harness.docs.set(write.path, write.method === 'update' ? { ...current, ...write.value } : write.value)
        }
        if (harness.failNextCommitAfterApply) {
          harness.failNextCommitAfterApply = false
          throw new Error('network response lost after commit')
        }
      },
    }
    return batch
  },
}))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'auth-parent-1' } }) }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./personalAccess', () => ({ currentEducationPersonId: () => 'person-parent-1' }))
vi.mock('./networkRetry', () => ({ fetchWithRetry: async () => ({ ok: true, status: 200 }) }))
vi.mock('./uiErrors', () => ({ reportUiError: () => {} }))

function snapshot(path: string) {
  const value = harness.docs.get(path)
  return { exists: () => Boolean(value), data: () => value }
}

import { removePendingDayPhoto, requestDayHelp, uploadDayPhoto } from './dayStore'
import { resumePhotoTransfer } from './photoOutbox'
import { requestFamilyBookUpload, resumeFamilyBookTransfer } from './familyBookUpload'
import type { FamilyBookUpload } from './familyLibrary'

function eventDocs() {
  return [...harness.docs.entries()].filter(([path]) => path.startsWith('educationEvents/'))
}

describe('Firestore education event producers', () => {
  beforeEach(() => {
    harness.docs.clear()
    harness.batches.length = 0
    harness.failNextCommitAfterApply = false
    harness.timestamp = 0
    harness.docs.set('dayOwners/day-token', { familyId: 'family-1', childId: 'child-1' })
    harness.docs.set('dayPages/day-token', { kind: 'student', date: '2026-10-20', targetDate: '2026-10-20',
      subjects: [{ tasks: [{ id: 'task-1', title: 'Тема', detail: 'Условие', source: 'МЭШ', kind: 'written', status: 'unknown' }] }],
      planRevision: 7, taskIds: ['task-1'] })
  })

  it('atomically records empty-text help requests, with separate operations for repeated requests', async () => {
    await requestDayHelp('day-token', 'task-1', 4, 'check', '')
    await requestDayHelp('day-token', 'task-1', 4, 'check', '')

    const source = harness.docs.get('dayHelp/day-token/items/task-1')
    const events = eventDocs().map(([, event]) => event)
    expect(harness.batches).toHaveLength(2)
    expect(harness.batches.every((batch) => batch.length === 2 && batch.some((write) => write.path.startsWith('dayHelp/'))
      && batch.some((write) => write.path.startsWith('educationEvents/')))).toBe(true)
    expect(events.map((event) => event.eventType)).toEqual(['help.requested', 'help.requested'])
    expect(new Set(events.map((event) => event.operationId)).size).toBe(2)
    expect(events.every((event) => event.sourceRef.documentPath === 'dayHelp/day-token/items/task-1')).toBe(true)
    expect(source).toMatchObject({ revision: 4, requestText: '', eventProducerVersion: 1 })
    expect(events.some((event) => event.eventId === source?.eventReceiptId)).toBe(true)
  })

  it('pairs a requested photo upload with the shared queue using source identifiers only', async () => {
    const file = new File(['private photo bytes'], 'work.png', { type: 'image/png' })
    const uploadId = 'upload-request-1234567890'
    await uploadDayPhoto('day-token', 'task-1', file, uploadId)
    const source = harness.docs.get(`dayUploads/day-token/files/${uploadId}`)
    const event = eventDocs()[0]?.[1]
    expect(harness.batches[0]).toHaveLength(2)
    expect(source).toMatchObject({ status: 'requested', taskId: 'task-1', eventOperationId: `upload-transfer:${uploadId}:requested` })
    expect(event).toMatchObject({ eventType: 'upload.transfer_requested', sourceRef: {
      kind: 'upload', documentPath: `dayUploads/day-token/files/${uploadId}`, recordId: uploadId, taskId: 'task-1',
    } })
    expect(JSON.stringify(event)).not.toContain('private photo bytes')
    expect(JSON.stringify(event)).not.toContain(source?.sha256)
  })

  it('accepts a refreshed plan revision when the visible task condition is unchanged', async () => {
    const uploadId = 'upload-stale-revision-123456'
    const visiblePage = harness.docs.get('dayPages/day-token') as any
    harness.docs.set('dayPages/day-token', { ...visiblePage, planRevision: 8 })
    await uploadDayPhoto('day-token', 'task-1', new File(['photo'], 'work.png', { type: 'image/png' }), uploadId, visiblePage)

    expect(harness.docs.get(`dayUploads/day-token/files/${uploadId}`)?.planRevision).toBe(8)
    expect(harness.batches[0]).toHaveLength(2)
    expect(eventDocs()).toHaveLength(1)
  })

  it('requires refresh when the server task condition differs from the visible cached card', async () => {
    const uploadId = 'upload-changed-condition-123456'
    const visiblePage = harness.docs.get('dayPages/day-token') as any
    harness.docs.set('dayPages/day-token', { ...visiblePage, planRevision: 8,
      subjects: [{ tasks: [{ ...visiblePage.subjects[0].tasks[0], detail: 'Новое условие' }] }] })

    await expect(uploadDayPhoto('day-token', 'task-1', new File(['photo'], 'work.png', { type: 'image/png' }), uploadId, visiblePage))
      .rejects.toThrow(/условие задания изменилось/i)
    expect(eventDocs()).toHaveLength(0)
    expect(harness.batches).toHaveLength(0)
  })

  it('treats a repeated uploadId with the same source hash as an idempotent success', async () => {
    const uploadId = 'upload-idempotent-retry-123456'
    const file = new File(['same photo'], 'work.png', { type: 'image/png' })
    await uploadDayPhoto('day-token', 'task-1', file, uploadId)
    harness.docs.set('dayPages/day-token', { ...harness.docs.get('dayPages/day-token'), planRevision: 99 })

    await expect(uploadDayPhoto('day-token', 'task-1', file, uploadId,
      { kind: 'student', date: 'stale', targetDate: 'stale', subjects: [] } as any)).resolves.toBe(uploadId)
    expect(harness.batches).toHaveLength(1)
    expect(eventDocs()).toHaveLength(1)
  })

  it('recognizes the worker-confirmed receipt when retrying an already pending photo', async () => {
    const uploadId = 'upload-confirmed-retry-123456'
    const file = new File(['same photo'], 'work.png', { type: 'image/png' })
    await uploadDayPhoto('day-token', 'task-1', file, uploadId)
    const path = `dayUploads/day-token/files/${uploadId}`
    const sourceRef = { kind: 'upload', documentPath: path, dayToken: 'day-token', recordId: uploadId, taskId: 'task-1' }
    const operationId = `upload-confirmed:${uploadId}`
    const eventId = await createEducationEventId({ eventType: 'upload.confirmed', familyId: 'family-1', childId: 'child-1',
      source: 'firestore', sourceRef, operationId })
    harness.docs.set(path, { ...harness.docs.get(path), status: 'pending', eventOperationId: operationId, eventReceiptId: eventId })

    await expect(uploadDayPhoto('day-token', 'task-1', file, uploadId)).resolves.toBe(uploadId)
    expect(harness.batches).toHaveLength(1)
    expect(eventDocs()).toHaveLength(1)
  })

  it('accepts the historical confirmed receipt only with stored matching bytes and uploaded operation id', async () => {
    const uploadId = 'upload-legacy-confirmed-123456'
    const file = new File(['same photo'], 'work.png', { type: 'image/png' })
    await uploadDayPhoto('day-token', 'task-1', file, uploadId)
    const path = `dayUploads/day-token/files/${uploadId}`
    const sourceRef = { kind: 'upload', documentPath: path, dayToken: 'day-token', recordId: uploadId, taskId: 'task-1' }
    const confirmedOperation = `upload-confirmed:${uploadId}`
    const confirmedReceipt = await createEducationEventId({ eventType: 'upload.confirmed', familyId: 'family-1', childId: 'child-1',
      source: 'firestore', sourceRef, operationId: confirmedOperation })
    harness.docs.set(path, { ...harness.docs.get(path), status: 'pending', eventOperationId: `upload-transfer:${uploadId}:uploaded`,
      eventReceiptId: confirmedReceipt, storage: { state: 'stored', sha256: harness.docs.get(path)?.sha256 } })

    await expect(uploadDayPhoto('day-token', 'task-1', file, uploadId)).resolves.toBe(uploadId)
    expect(harness.batches).toHaveLength(1)
  })

  it('does not report an upload-error source as a successful retry', async () => {
    const uploadId = 'upload-failed-retry-123456'
    const file = new File(['same photo'], 'work.png', { type: 'image/png' })
    await uploadDayPhoto('day-token', 'task-1', file, uploadId)
    const path = `dayUploads/day-token/files/${uploadId}`
    harness.docs.set(path, { ...harness.docs.get(path), status: 'upload-error' })

    await expect(uploadDayPhoto('day-token', 'task-1', file, uploadId)).rejects.toThrow(/ожидает повтора обработчиком/i)
    expect(harness.batches).toHaveLength(1)
  })

  it('atomically appends bytes-uploaded after storage transfer and accepts ambiguous commit readback', async () => {
    const uploadId = 'upload-bytes-1234567890'
    const path = `dayUploads/day-token/files/${uploadId}`
    await uploadDayPhoto('day-token', 'task-1', new File(['bytes'], 'work.png', { type: 'image/png' }), uploadId)
    harness.docs.set(path, { ...harness.docs.get(path), status: 'awaiting-upload', upload: { href: 'https://disk.yandex.net/upload/opaque' } })
    harness.failNextCommitAfterApply = true
    resumePhotoTransfer('day-token', uploadId, { status: 'awaiting-upload', taskId: 'task-1', deviceUid: 'auth-parent-1',
      upload: { href: 'https://disk.yandex.net/upload/opaque' } })

    await vi.waitFor(() => expect(harness.docs.get(path)?.status).toBe('uploaded'))
    const source = harness.docs.get(path)
    const events = eventDocs().map(([, event]) => event)
    expect(harness.batches[1]).toHaveLength(2)
    expect(source?.eventOperationId).toBe(`upload-transfer:${uploadId}:uploaded`)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ eventType: 'upload.bytes_uploaded', eventId: source?.eventReceiptId,
      sourceRef: { documentPath: path, recordId: uploadId, taskId: 'task-1' } })
  })

  it('atomically pairs a student photo deletion with its queue event', async () => {
    const uploadId = 'upload-delete-1234567890'
    const path = `dayUploads/day-token/files/${uploadId}`
    harness.docs.set(path, { taskId: 'task-1', status: 'pending', sha256: 'a'.repeat(64) })
    await removePendingDayPhoto('day-token', uploadId)

    expect(harness.docs.get(path)).toMatchObject({ status: 'deleted', eventOperationId: `upload-delete:${uploadId}`, eventProducerVersion: 1 })
    expect(harness.batches.at(-1)).toHaveLength(2)
    expect(eventDocs().at(-1)?.[1]).toMatchObject({ eventType: 'upload.delete_requested',
      sourceRef: { documentPath: path, taskId: 'task-1' } })
  })

  it('pairs book upload request and uploaded-byte events with their status transitions', async () => {
    const file = new File(['PDF bytes'], 'textbook.pdf', { type: 'application/pdf' })
    const uploadId = await requestFamilyBookUpload('family-1', 'child-1', 'math', file)
    const path = `families/family-1/children/child-1/bookUploads/${uploadId}`
    const requestSource = harness.docs.get(path)
    const requestEvent = eventDocs().map(([, event]) => event).find((event) => event.eventType === 'material.upload_requested')
    expect(requestSource).toMatchObject({ status: 'requested', subjectKey: 'math', eventOperationId: `material-upload:${uploadId}` })
    expect(requestEvent?.sourceRef.documentPath).toBe(path)

    harness.docs.set(path, { ...requestSource, status: 'awaiting-upload', upload: { href: 'https://disk.yandex.net/upload/book' } })
    resumeFamilyBookTransfer('family-1', 'child-1', { id: uploadId, status: 'awaiting-upload', upload: { href: 'https://disk.yandex.net/upload/book' } } as FamilyBookUpload)
    await vi.waitFor(() => expect(harness.docs.get(path)?.status).toBe('uploaded'))
    const source = harness.docs.get(path)
    const events = eventDocs().map(([, event]) => event)
    expect(events.map((event) => event.eventType)).toEqual(['material.upload_requested', 'material.bytes_uploaded'])
    expect(events[1]).toMatchObject({ eventId: source?.eventReceiptId,
      operationId: `material-upload:${uploadId}:uploaded`, sourceRef: { documentPath: path, recordId: uploadId } })
    expect(source?.eventOperationId).toBe(`material-upload:${uploadId}:uploaded`)
  })
})
