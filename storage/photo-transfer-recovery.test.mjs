import { describe, expect, it, vi } from 'vitest'
import { inspectPhotoTransfer, recoverPhotoTransfer } from './photo-transfer-recovery.mjs'

const token = 'abcdefghijklmnopqrstuvwx', uploadId = 'uploadabcdefghijklmnopq'
const familyId = 'familyabcdefghijklmnop', childId = 'childabcdefghijklmnopq'
const path = `dayUploads/${token}/files/${uploadId}`
function fixture() {
  const rows = new Map([
    [`dayOwners/${token}`, { date: '2026-11-08', familyId, childId }],
    [`dayPages/${token}`, { date: '2026-11-08', targetDate: '2026-11-09', kind: 'student', taskIds: ['t'], planRevision: 10 }],
    [path, { status: 'upload-error', taskId: 't', planRevision: 9, deviceUid: token, contentType: 'image/jpeg', size: 3, sha256: 'a'.repeat(64), error: 'old' }],
    [`deviceSessions/${token}`, { linkToken: 'grant' }],
    ['accessLinks/grant', { active: true, personId: 'p' }],
    [`families/${familyId}/members/p`, { active: true, role: 'student', childIds: [childId] }],
  ])
  const ref = p => ({ path: p, id: p.split('/').at(-1), async get() { return snap(p) } })
  const snap = p => ({ exists: rows.has(p), data: () => rows.get(p) })
  const writes = []
  const update = (r, v) => { rows.set(r.path, { ...rows.get(r.path), ...v }); writes.push(r.path) }
  const set = (r, v) => { rows.set(r.path, v); writes.push(r.path) }
  const db = { doc: ref, collection: p => ({ doc: id => ref(`${p}/${id}`), async get() {
    return { docs: [...rows].filter(([key]) => key.startsWith(p + '/') && key.slice(p.length + 1).indexOf('/') < 0).map(([key]) => ({ id: key.split('/').at(-1), data: () => rows.get(key) })) }
  } }), batch: () => ({ set, async commit() {} }), async runTransaction(fn) {
    return fn({ get: async r => snap(r.path), set, create: set, update })
  } }
  return { db, disk: { head: vi.fn(async () => null) }, dayToken: token, uploadId, rows, writes }
}
describe('exact photo transfer recovery', () => {
  it('diagnoses the day revision race without changing data or exposing credentials', async () => {
    const f = fixture(), { summary } = await inspectPhotoTransfer(f)
    expect(summary).toMatchObject({ revisionChanged: true, authorizedNow: true, requestRevision: 9, pageRevision: 10, remoteFilePresent: false })
    expect(f.writes).toEqual([])
    expect(JSON.stringify(summary)).not.toContain('deviceUid')
  })
  it('restarts the same request once, preserves its revision and sends one addressed in-app request', async () => {
    const f = fixture()
    expect(await recoverPhotoTransfer(f)).toMatchObject({ resumed: true, readbackVerified: true, originalRevisionPreserved: true, recipients: 1 })
    expect(f.rows.get(path)).toMatchObject({ status: 'requested', planRevision: 9 })
    const events = [...f.rows].filter(([p]) => p.startsWith('educationEvents/'))
    expect(events).toHaveLength(1)
    expect(events[0][1].operationId).toBe(`upload-recovery:${uploadId}:10`)
    const notice = [...f.rows].find(([p]) => p.startsWith('users/p/inbox/'))[1]
    expect(notice.body).toContain('Переписывать работу не нужно')
    expect(notice.familyId).toBe(familyId)
    await recoverPhotoTransfer(f)
    expect([...f.rows.keys()].filter(p => p.startsWith('educationEvents/'))).toHaveLength(1)
    expect([...f.rows.keys()].filter(p => p.startsWith('users/'))).toHaveLength(1)
  })
  it.each(['removed-task', 'revoked-member', 'future-revision'])('does not resume %s', async reason => {
    const f = fixture()
    if (reason === 'removed-task') f.rows.get(`dayPages/${token}`).taskIds = []
    if (reason === 'revoked-member') f.rows.get(`families/${familyId}/members/p`).active = false
    if (reason === 'future-revision') f.rows.get(path).planRevision = 11
    await expect(recoverPhotoTransfer(f)).rejects.toThrow('photo_current_authorization_required')
    expect(f.writes).toEqual([])
  })
  it('never resurrects a photo deleted concurrently with recovery', async () => {
    const f = fixture(), transact = f.db.runTransaction
    f.db.runTransaction = fn => { f.rows.get(path).status = 'deleted'; return transact(fn) }
    await expect(recoverPhotoTransfer(f)).rejects.toThrow('photo_not_recoverable')
    expect(f.writes).toEqual([])
  })
  it('rechecks revoked membership inside the recovery transaction', async () => {
    const f = fixture(), transact = f.db.runTransaction
    f.db.runTransaction = fn => { f.rows.get(`families/${familyId}/members/p`).active = false; return transact(fn) }
    await expect(recoverPhotoTransfer(f)).rejects.toThrow('photo_current_authorization_required')
    expect(f.writes).toEqual([])
  })
})


it('separates a ready server link from stale client waiting-link diagnostics', async () => {
  const f = fixture(), stamp = text => ({ toDate: () => new Date(text) })
  f.rows.set(path, { ...f.rows.get(path), status: 'awaiting-upload', upload: { href: 'secret-upload-url', issuedAt: stamp('2026-11-08T10:00:00Z') },
    clientTransfer: { phase: 'waiting-link', at: stamp('2026-11-07T18:39:27Z'), attempt: 0 } })
  const { summary } = await inspectPhotoTransfer(f)
  expect(summary).toMatchObject({ serverStage: 'link-ready', clientObservedAfterLink: false, deliveryStage: 'client-not-observed-after-link' })
  expect(JSON.stringify(summary)).not.toContain('secret-upload-url')
  expect(f.writes).toEqual([])
})
