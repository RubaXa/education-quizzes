import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const { projectFamilyBookMock } = vi.hoisted(() => ({ projectFamilyBookMock: vi.fn(async () => ({ status: 'ready', pages: 1, projected: 0 })) }))
vi.mock('../../storage/family-book-projection.mjs', () => ({ projectPublishedBookToFamily: projectFamilyBookMock }))
import { createUploadBrokerHandlers, createUploadReconciliationProducer } from './upload-broker.mjs'

const id = 'abcdefghijklmnopqrstuvwx'
const familyId = 'familyabcdefghijklmnop'
const childId = 'childabcdefghijklmnopq'
const taskId = 'taskabcdefghijklmnopqr'
const sha = 'a'.repeat(64)

describe('upload queue broker', () => {
  it('schedules compatibility reconciliation at 15 second intervals', async () => {
    const setTimer = vi.fn(() => ({ unref() {} }))
    const db = { collectionGroup: () => ({ where() { return this }, orderBy() { return this }, limit() { return this },
      async get() { return { docs: [], size: 0 } } }) }
    const producer = createUploadReconciliationProducer({ db, setTimer })
    producer.start()
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 15_000)
    await producer.stop()
  })

  it('issues photo transfer URLs from the exact source event without source listeners', async () => {
    const rows = new Map([
      [`dayOwners/${id}`, { date: '2026-10-19', familyId, childId }],
      [`dayPages/${id}`, { date: '2026-10-19', kind: 'student', taskIds: [taskId], planRevision: 7 }],
      [`dayUploads/${id}/files/${id}`, { taskId, planRevision: 7, deviceUid: id, contentType: 'image/jpeg', size: 3,
        sha256: sha, status: 'requested' }],
      [`deviceSessions/${id}`, { linkToken: 'linktoken12345678901234' }],
      ['accessLinks/linktoken12345678901234', { active: true, personId: 'student-person' }],
      [`families/${familyId}/members/student-person`, { active: true, role: 'student', childIds: [childId] }],
    ])
    const refs = new Map()
    let sourceWatchCalls = 0
    const db = { doc(path) {
      if (!refs.has(path)) refs.set(path, {
        path,
        async get() { const value = rows.get(path); return { exists: value !== undefined, data: () => value } },
        async update(value) { rows.set(path, { ...rows.get(path), ...value }) },
        onSnapshot() { sourceWatchCalls += 1; throw new Error('source subscriptions are forbidden') },
      })
      return refs.get(path)
    } }
    const disk = {
      async head() { return null },
      async ensureFolder() {},
      async request() { return { method: 'PUT', href: 'https://uploader.yandex.net/path' } },
    }
    const handlers = createUploadBrokerHandlers({ db, disk })
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(['upload.transfer_requested', 'upload.bytes_uploaded', 'material.upload_requested']))
    expect(Object.keys(handlers)).not.toContain('upload.confirmed')
    await handlers['upload.transfer_requested']({ eventType: 'upload.transfer_requested', familyId, childId,
      sourceRef: { kind: 'upload', documentPath: `dayUploads/${id}/files/${id}`, dayToken: id, recordId: id, taskId } })
    const updated = rows.get(`dayUploads/${id}/files/${id}`)
    expect(updated.status).toBe('awaiting-upload')
    expect(updated.upload.href).toBe('https://uploader.yandex.net/path')
    expect(updated.upload.issuedAt).toBeTruthy()
    expect(sourceWatchCalls).toBe(0)
  })

  it('stages upload.confirmed in the same transaction that finalizes the source', async () => {
    const path = `dayUploads/${id}/files/${id}`
    const bytes = Buffer.from([0xff, 0xd8, 0xff])
    const request = { taskId, planRevision: 7, deviceUid: id, contentType: 'image/jpeg', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), status: 'uploaded' }
    const rows = new Map([
      [`dayOwners/${id}`, { date: '2026-10-19', familyId, childId }],
      [`dayPages/${id}`, { date: '2026-10-19', kind: 'student', taskIds: [taskId], planRevision: 7 }],
      [path, request],
      [`deviceSessions/${id}`, { linkToken: 'linktoken12345678901234' }],
      ['accessLinks/linktoken12345678901234', { active: true, personId: 'student-person' }],
      [`families/${familyId}/members/student-person`, { active: true, role: 'student', childIds: [childId] }],
    ])
    const refs = new Map()
    const makeRef = (refPath) => {
      if (!refs.has(refPath)) refs.set(refPath, { path: refPath, id: refPath.split('/').at(-1),
        async get() { const value = rows.get(refPath); return { exists: value !== undefined, data: () => value } },
        async update(value) { rows.set(refPath, { ...rows.get(refPath), ...value }) } })
      return refs.get(refPath)
    }
    const db = {
      doc: makeRef,
      collection(name) { return { doc: (docId) => makeRef(`${name}/${docId}`) } },
      async runTransaction(callback) {
        const tx = {
          async get(ref) { const value = rows.get(ref.path); return { exists: value !== undefined, data: () => value } },
          create(ref, value) { rows.set(ref.path, value) },
          update(ref, value) { rows.set(ref.path, { ...rows.get(ref.path), ...value }) },
          set(ref, value, options) { rows.set(ref.path, options?.merge ? { ...rows.get(ref.path), ...value } : value) },
        }
        return callback(tx)
      },
    }
    const disk = {
      async head() { return { type: 'file', size: bytes.length, md5: createHash('md5').update(bytes).digest('hex') } },
      async getAt() { return bytes },
      async publish() { return 'https://disk.yandex.ru/public/photo' },
    }
    const handlers = createUploadBrokerHandlers({ db, disk })
    await handlers['upload.bytes_uploaded']({ eventType: 'upload.bytes_uploaded', familyId, childId,
      sourceRef: { kind: 'upload', documentPath: path, dayToken: id, recordId: id, taskId } })
    const finalized = rows.get(path)
    expect(finalized.status).toBe('pending')
    expect(finalized.storage.sha256).toBe(request.sha256)
    expect(finalized.eventProducerVersion).toBe(1)
    expect(finalized.eventReceiptId).toMatch(/^[a-f0-9]{64}$/)
    const event = rows.get(`educationEvents/${finalized.eventReceiptId}`)
    expect(event.eventType).toBe('upload.confirmed')
    expect(event.operationId).toBe(`upload-confirmed:${id}`)
    expect(event.state).toBe('pending')
  })

  it('stages material.ready atomically when a valid family PDF is stored', async () => {
    const uploadId = 'bookabcdefghijklmnopq'
    const path = `families/${familyId}/children/${childId}/bookUploads/${uploadId}`
    const bytes = Buffer.from('%PDF-')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const request = { subjectKey: 'math', originalName: 'book.pdf', contentType: 'application/pdf', size: bytes.length,
      sha256, deviceUid: id, status: 'uploaded' }
    const rows = new Map([
      [path, request],
      [`deviceSessions/${id}`, { linkToken: 'parentlink12345678901234' }],
      ['accessLinks/parentlink12345678901234', { active: true, personId: 'parent-person' }],
      [`families/${familyId}/members/parent-person`, { active: true, role: 'parent', childIds: [childId] }],
    ])
    const refs = new Map()
    const makeRef = (refPath) => {
      if (!refs.has(refPath)) refs.set(refPath, { path: refPath, id: refPath.split('/').at(-1),
        async get() { const value = rows.get(refPath); return { exists: value !== undefined, data: () => value } },
        async update(value) { rows.set(refPath, { ...rows.get(refPath), ...value }) },
        async set(value, options) { rows.set(refPath, options?.merge ? { ...rows.get(refPath), ...value } : value) } })
      return refs.get(refPath)
    }
    const db = {
      doc: makeRef,
      collection(name) {
        if (name === 'materialBooks') return { where() { return { async get() { return { docs: [] } } } } }
        return { doc: (docId) => makeRef(`${name}/${docId}`) }
      },
      async runTransaction(callback) {
        const tx = {
          async get(ref) { const value = rows.get(ref.path); return { exists: value !== undefined, data: () => value } },
          create(ref, value) { rows.set(ref.path, value) },
          update(ref, value) { rows.set(ref.path, { ...rows.get(ref.path), ...value }) },
          set(ref, value, options) { rows.set(ref.path, options?.merge ? { ...rows.get(ref.path), ...value } : value) },
        }
        return callback(tx)
      },
    }
    const disk = {
      async head(pathname) { return pathname === `app:/PETR/Учебники/Загрузки/${familyId}/${childId}/${uploadId}.pdf`
        ? { type: 'file', size: bytes.length } : null },
      async getAt() { return bytes },
      async putAt() {},
      async removeFamilyBookStagingAt() {},
    }
    const handlers = createUploadBrokerHandlers({ db, disk })
    await handlers['material.bytes_uploaded']({ eventType: 'material.bytes_uploaded', familyId, childId,
      sourceRef: { kind: 'material', documentPath: path, recordId: uploadId } })
    const finalized = rows.get(path)
    expect(finalized.status).toBe('needs-identification')
    expect(finalized.storage.state).toBe('stored')
    expect(finalized.eventReceiptId).toMatch(/^[a-f0-9]{64}$/)
    expect(rows.get(`educationEvents/${finalized.eventReceiptId}`).eventType).toBe('material.ready')
  })

  it('preserves exact-book linking, projection and staging cleanup after an atomic ready commit', async () => {
    projectFamilyBookMock.mockClear()
    const uploadId = 'bookabcdefghijklmnopq'
    const bookId = 'mathbookabcdefghijklmn'
    const path = `families/${familyId}/children/${childId}/bookUploads/${uploadId}`
    const sharedPath = `app:/PETR/Учебники/Общий архив/ab/${'a'.repeat(64)}.pdf`
    const bytes = Buffer.from('%PDF-')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const md5 = createHash('md5').update(bytes).digest('hex')
    const request = { subjectKey: 'math', originalName: 'book.pdf', contentType: 'application/pdf', size: bytes.length,
      sha256, deviceUid: id, status: 'uploaded' }
    const rows = new Map([
      [path, request],
      [`deviceSessions/${id}`, { linkToken: 'parentlink12345678901234' }],
      ['accessLinks/parentlink12345678901234', { active: true, personId: 'parent-person' }],
      [`families/${familyId}/members/parent-person`, { active: true, role: 'parent', childIds: [childId] }],
      [`storedObjects/${sha256}`, { path: sharedPath }],
    ])
    const refs = new Map()
    const makeRef = (refPath) => {
      if (!refs.has(refPath)) refs.set(refPath, { path: refPath, id: refPath.split('/').at(-1),
        async get() { const value = rows.get(refPath); return { exists: value !== undefined, data: () => value } },
        async update(value) { rows.set(refPath, { ...rows.get(refPath), ...value }) },
        async set(value, options) { rows.set(refPath, options?.merge ? { ...rows.get(refPath), ...value } : value) } })
      return refs.get(refPath)
    }
    const book = { id: bookId, data: () => ({ role: 'student-textbook', subject: 'math', title: 'Math',
      sourceSha256: 'c'.repeat(64), editionStatus: 'confirmed' }) }
    const db = {
      doc: makeRef,
      collection(name) {
        if (name === 'materialBooks') return { where() { return { async get() { return { docs: [book] } } } } }
        return { doc: (docId) => makeRef(`${name}/${docId}`) }
      },
      async runTransaction(callback) {
        const tx = {
          async get(ref) { const value = rows.get(ref.path); return { exists: value !== undefined, data: () => value } },
          create(ref, value) { rows.set(ref.path, value) },
          update(ref, value) { rows.set(ref.path, { ...rows.get(ref.path), ...value }) },
          set(ref, value, options) { rows.set(ref.path, options?.merge ? { ...rows.get(ref.path), ...value } : value) },
        }
        return callback(tx)
      },
    }
    const removeFamilyBookStagingAt = vi.fn()
    const disk = { async head(pathname) { return pathname === sharedPath
      ? { type: 'file', size: bytes.length, md5 } : { type: 'file', size: bytes.length } },
    async getAt() { return bytes }, removeFamilyBookStagingAt }
    await createUploadBrokerHandlers({ db, disk })['material.bytes_uploaded']({ eventType: 'material.bytes_uploaded', familyId, childId,
      sourceRef: { kind: 'material', documentPath: path, recordId: uploadId } })
    expect(rows.get(path).status).toBe('linked')
    expect(rows.get(path).bookId).toBe(bookId)
    expect(rows.get(`families/${familyId}/children/${childId}/books/${bookId}`).status).toBe('confirmed')
    expect(rows.get(`educationEvents/${rows.get(path).eventReceiptId}`).eventType).toBe('material.ready')
    expect(projectFamilyBookMock).toHaveBeenCalledTimes(1)
    expect(removeFamilyBookStagingAt).toHaveBeenCalledTimes(1)
  })

  it('removes a verified public photo if deletion wins the finalization race', async () => {
    const path = `dayUploads/${id}/files/${id}`
    const bytes = Buffer.from([0xff, 0xd8, 0xff])
    const request = { taskId, planRevision: 7, deviceUid: id, contentType: 'image/jpeg', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), status: 'uploaded' }
    const { db, rows } = photoDb(request, { beforeTransaction: () => { rows.set(path, { ...request, status: 'deleted' }) } })
    const removeWorkAt = vi.fn()
    const disk = { async head() { return { type: 'file', size: bytes.length, md5: createHash('md5').update(bytes).digest('hex') } },
      async getAt() { return bytes }, async publish() { return 'https://disk.yandex.ru/public/photo' }, removeWorkAt }
    await createUploadBrokerHandlers({ db, disk })['upload.bytes_uploaded']({ eventType: 'upload.bytes_uploaded', familyId, childId,
      sourceRef: { kind: 'upload', documentPath: path, dayToken: id, recordId: id, taskId } })
    expect(rows.get(path).status).toBe('deleted')
    expect(removeWorkAt).toHaveBeenCalledTimes(1)
    expect([...rows.keys()].some((key) => key.startsWith('educationEvents/'))).toBe(false)
  })

  it('cleans a verified photo when the student permission is revoked before processing', async () => {
    const path = `dayUploads/${id}/files/${id}`
    const bytes = Buffer.from([0xff, 0xd8, 0xff])
    const request = { taskId, planRevision: 7, deviceUid: id, contentType: 'image/jpeg', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), status: 'uploaded' }
    const { db, rows } = photoDb(request, { activeMember: false })
    const removeWorkAt = vi.fn()
    const disk = { async head() { return { type: 'file', size: bytes.length, md5: createHash('md5').update(bytes).digest('hex') } }, removeWorkAt }
    await createUploadBrokerHandlers({ db, disk })['upload.bytes_uploaded']({ eventType: 'upload.bytes_uploaded', familyId, childId,
      sourceRef: { kind: 'upload', documentPath: path, dayToken: id, recordId: id, taskId } })
    expect(rows.get(path).status).toBe('upload-error')
    expect(removeWorkAt).toHaveBeenCalledTimes(1)
    expect([...rows.keys()].some((key) => key.startsWith('educationEvents/'))).toBe(false)
  })

  it.each(['remote-size', 'content-hash'])('rejects a corrupt photo before finalization (%s)', async (corruption) => {
    const path = `dayUploads/${id}/files/${id}`
    const bytes = Buffer.from([0xff, 0xd8, 0xff])
    const request = { taskId, planRevision: 7, deviceUid: id, contentType: 'image/jpeg', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), status: 'uploaded' }
    if (corruption === 'content-hash') request.sha256 = 'b'.repeat(64)
    const { db, rows } = photoDb(request)
    const disk = { async head() { return { type: 'file', size: corruption === 'remote-size' ? bytes.length + 1 : bytes.length,
      md5: createHash('md5').update(bytes).digest('hex') } }, async getAt() { return bytes }, async publish() { throw new Error('must not publish') } }
    await expect(createUploadBrokerHandlers({ db, disk })['upload.bytes_uploaded']({ eventType: 'upload.bytes_uploaded', familyId, childId,
      sourceRef: { kind: 'upload', documentPath: path, dayToken: id, recordId: id, taskId } }))
      .rejects.toMatchObject({ safeCode: corruption === 'remote-size' ? 'upload_size_mismatch' : 'upload_content_mismatch' })
    expect(rows.get(path).status).toBe('uploaded')
    expect([...rows.keys()].some((key) => key.startsWith('educationEvents/'))).toBe(false)
  })

  it('reconciles only bounded pages into the event queue and never subscribes to sources', async () => {
    const ownerReads = []
    const published = []
    const groupReads = []
    const photoDoc = { id, ref: { path: `dayUploads/${id}/files/${id}` }, data: () => ({ status: 'requested', taskId }) }
    const bookId = 'bookabcdefghijklmnopq'
    const bookDoc = { id: bookId, ref: { path: `families/${familyId}/children/${childId}/bookUploads/${bookId}` },
      data: () => ({ status: 'requested' }) }
    const groups = { files: [photoDoc], bookUploads: [bookDoc] }
    const db = {
      collectionGroup(group) {
        const query = { where() { return this }, orderBy() { return this }, limit(count) { this.count = count; return this },
          startAfter() { return this }, async get() { groupReads.push(group); return { docs: groups[group].slice(0, this.count), size: groups[group].length } } }
        return query
      },
      doc(path) { return { async get() { ownerReads.push(path); return { data: () => ({ familyId, childId }) } } } },
    }
    const reconcile = createUploadReconciliationProducer({ db, pageSize: 1, publish: async (_db, event) => published.push(event) })
    await reconcile.runOne()
    expect(ownerReads).toContain(`dayOwners/${id}`)
    expect(published.map((item) => item.eventType)).toEqual(['upload.transfer_requested', 'material.upload_requested'])
    expect(published[0].operationId).toBe(`upload-transfer:${id}:requested`)
    expect(published[1].sourceRef).toEqual({ kind: 'material', documentPath: bookDoc.ref.path, recordId: bookId })
    expect(published).toHaveLength(2)
    expect(groupReads).toEqual(['files', 'bookUploads'])
  })

  it('recovers only stored pending photos and unidentified stored books, never reviewed or linked records', async () => {
    const photoPath = `dayUploads/${id}/files/${id}`
    const oldPhotoPath = `dayUploads/${id}/files/oldphotoabcdefghijklmnop`
    const bookId = 'bookabcdefghijklmnopq'
    const bookPath = `families/${familyId}/children/${childId}/bookUploads/${bookId}`
    const linkedId = 'booklinkedabcdefghijkl'
    const docs = [
      { ref: { path: photoPath }, data: () => ({ status: 'pending', taskId, storage: { state: 'stored' } }) },
      { ref: { path: oldPhotoPath }, data: () => ({ status: 'reviewed', taskId, storage: { state: 'stored' } }) },
      { ref: { path: bookPath }, data: () => ({ status: 'needs-identification', storage: { state: 'stored' } }) },
      { ref: { path: `families/${familyId}/children/${childId}/bookUploads/${linkedId}` },
        data: () => ({ status: 'linked', storage: { state: 'stored' } }) },
    ]
    const published = []
    const db = {
      collectionGroup(group) { return { where() { return this }, orderBy() { return this }, limit() { return this },
        async get() { return { docs: group === 'files' ? docs.slice(0, 2) : docs.slice(2), size: 2 } } } },
      doc(path) { return { async get() { return { data: () => path === `dayOwners/${id}` ? { familyId, childId } : {} } } } },
    }
    await createUploadReconciliationProducer({ db, publish: async (_db, event) => published.push(event) }).runOne()
    expect(published.map(({ eventType }) => eventType)).toEqual(['upload.confirmed', 'material.ready'])
    expect(published[0].operationId).toBe(`upload-confirmed:${id}`)
    expect(published[0].sourceRef).toEqual({ kind: 'upload', documentPath: photoPath, dayToken: id, recordId: id, taskId })
    expect(published[1].operationId).toBe(`material-ready:${bookId}`)
  })
})

function photoDb(request, { activeMember = true, beforeTransaction = () => {} } = {}) {
  const path = `dayUploads/${id}/files/${id}`
  const rows = new Map([
    [`dayOwners/${id}`, { date: '2026-10-19', familyId, childId }],
    [`dayPages/${id}`, { date: '2026-10-19', kind: 'student', taskIds: [taskId], planRevision: 7 }],
    [path, request],
    [`deviceSessions/${id}`, { linkToken: 'linktoken12345678901234' }],
    ['accessLinks/linktoken12345678901234', { active: true, personId: 'student-person' }],
    [`families/${familyId}/members/student-person`, { active: activeMember, role: 'student', childIds: [childId] }],
  ])
  const refs = new Map()
  const makeRef = (refPath) => {
    if (!refs.has(refPath)) refs.set(refPath, { path: refPath, id: refPath.split('/').at(-1),
      async get() { const value = rows.get(refPath); return { exists: value !== undefined, data: () => value } },
      async update(value) { rows.set(refPath, { ...rows.get(refPath), ...value }) },
      async delete() { rows.delete(refPath) } })
    return refs.get(refPath)
  }
  const db = {
    doc: makeRef,
    collection(name) { return { doc: (docId) => makeRef(`${name}/${docId}`) } },
    async runTransaction(callback) {
      beforeTransaction()
      const tx = {
        async get(ref) { const value = rows.get(ref.path); return { exists: value !== undefined, data: () => value } },
        create(ref, value) { rows.set(ref.path, value) },
        update(ref, value) { rows.set(ref.path, { ...rows.get(ref.path), ...value }) },
        set(ref, value, options) { rows.set(ref.path, options?.merge ? { ...rows.get(ref.path), ...value } : value) },
      }
      return callback(tx)
    },
  }
  return { db, rows }
}
