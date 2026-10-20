/** Synthetic Firestore Rules REST :test cases for the student photo upload boundary.
 * Uses fictional IDs and no credentials; a caller supplies auth only to the REST client.
 * @see ../docs/modules/synchronization/event-queue.md#доступ-и-приватность
 * @see ../docs/decisions/photo-upload-authorization-and-freshness-2026-10-20.md
 */
const databasePrefix = '/databases/(default)/documents/'
const fixture = {
  uid: 'fixture-device', personId: 'fixture-student', familyId: 'fixture-family', childId: 'fixture-child',
  dayToken: 'D'.repeat(43), linkToken: 'L'.repeat(43), uploadId: '11111111-1111-4111-8111-111111111111',
  taskId: 'mesh-fixture-task', eventId: 'e'.repeat(64), time: '2026-10-20T16:25:00Z',
}

function documents({ memberRole = 'student', ownerFamilyId = fixture.familyId, ownerChildId = fixture.childId,
  pageTaskIds = [fixture.taskId], pageRevision = 7, source = {}, event = {} } = {}) {
  const sourcePath = `dayUploads/${fixture.dayToken}/files/${fixture.uploadId}`
  const eventPath = `educationEvents/${fixture.eventId}`
  return {
    [`deviceSessions/${fixture.uid}`]: { linkToken: fixture.linkToken },
    [`accessLinks/${fixture.linkToken}`]: { active: true, personId: fixture.personId },
    [`families/${fixture.familyId}/members/${fixture.personId}`]: {
      active: true, role: memberRole, childIds: [fixture.childId],
    },
    [`dayOwners/${fixture.dayToken}`]: { familyId: ownerFamilyId, childId: ownerChildId },
    [`dayPages/${fixture.dayToken}`]: { kind: 'student', taskIds: pageTaskIds, planRevision: pageRevision },
    [sourcePath]: { taskId: fixture.taskId, planRevision: 7, deviceUid: fixture.uid, contentType: 'image/png',
      size: 12345, sha256: 'a'.repeat(64), status: 'requested', createdAt: fixture.time,
      eventOperationId: `upload-transfer:${fixture.uploadId}:requested`, eventReceiptId: fixture.eventId,
      eventProducerVersion: 1, ...source },
    [eventPath]: { schemaVersion: 1, eventId: fixture.eventId, eventType: 'upload.transfer_requested',
      familyId: fixture.familyId, childId: fixture.childId, source: 'firestore',
      sourceRef: { kind: 'upload', documentPath: sourcePath, dayToken: fixture.dayToken,
        recordId: fixture.uploadId, taskId: fixture.taskId },
      operationId: `upload-transfer:${fixture.uploadId}:requested`, actor: { type: 'user', uid: fixture.uid },
      createdAt: fixture.time, state: 'pending', availableAt: fixture.time, attempts: 0, ...event },
  }
}

function mockFunctions(docs) {
  return Object.entries(docs).flatMap(([path, data]) => ['get', 'getAfter', 'exists', 'existsAfter'].map((fn) => ({
    function: fn,
    args: [{ exactValue: `${databasePrefix}${path}` }],
    result: { value: fn.startsWith('exists') ? true : { data } },
  })))
}

function requestCase({ name, path, resource, docs, expectation = 'ALLOW', method = 'create', priorResource = null }) {
  return {
    name,
    expectation,
    resource: priorResource ? { data: priorResource } : null,
    request: { auth: { uid: fixture.uid }, path: `${databasePrefix}${path}`, method, time: fixture.time, resource: { data: resource } },
    functionMocks: mockFunctions(docs),
  }
}

/** Valid pair and negative scope/role/device/task cases; safe to send to Firestore Rules :test. */
export function createPhotoUploadRulesTestSuite() {
  const baseDocs = documents()
  const sourcePath = `dayUploads/${fixture.dayToken}/files/${fixture.uploadId}`
  const eventPath = `educationEvents/${fixture.eventId}`
  const event = baseDocs[eventPath]
  const source = baseDocs[sourcePath]
  return [
    requestCase({ name: 'student-source-create-with-event-receipt', path: sourcePath, resource: source, docs: baseDocs }),
    requestCase({ name: 'student-queue-event-create-with-atomic-source', path: eventPath, resource: event, docs: baseDocs }),
    requestCase({ name: 'queue-event-denies-parent-role', path: eventPath, resource: event,
      docs: documents({ memberRole: 'parent' }), expectation: 'DENY' }),
    requestCase({ name: 'queue-event-denies-owner-family-mismatch', path: eventPath, resource: event,
      docs: documents({ ownerFamilyId: 'fixture-other-family' }), expectation: 'DENY' }),
    requestCase({ name: 'queue-event-denies-source-device-mismatch', path: eventPath, resource: event,
      docs: documents({ source: { deviceUid: 'fixture-other-device' } }), expectation: 'DENY' }),
    requestCase({ name: 'queue-event-denies-task-mismatch', path: eventPath, resource: event,
      docs: documents({ source: { taskId: 'fixture-other-task' } }), expectation: 'DENY' }),
    requestCase({ name: 'queue-event-denies-malformed-source-path', path: eventPath, resource: {
      ...event, sourceRef: { ...event.sourceRef, documentPath: `dayUploads/${fixture.dayToken}/wrong/${fixture.uploadId}` },
    }, docs: baseDocs, expectation: 'DENY' }),
    requestCase({ name: 'queue-event-denies-unlinked-child', path: eventPath, resource: { ...event, childId: 'fixture-other-child' },
      docs: baseDocs, expectation: 'DENY' }),
    requestCase({ name: 'queue-event-denies-missing-source-receipt', path: eventPath, resource: event,
      docs: documents({ source: { eventReceiptId: 'f'.repeat(64) } }), expectation: 'DENY' }),
    requestCase({ name: 'queue-event-denies-actor-uid-spoofing', path: eventPath, resource: {
      ...event, actor: { type: 'user', uid: 'fixture-other-device' },
    }, docs: baseDocs, expectation: 'DENY' }),
    requestCase({ name: 'student-source-denies-parent-role', path: sourcePath, resource: source,
      docs: documents({ memberRole: 'parent' }), expectation: 'DENY' }),
    requestCase({ name: 'student-source-denies-task-outside-published-page', path: sourcePath, resource: source,
      docs: documents({ pageTaskIds: ['fixture-other-task'] }), expectation: 'DENY' }),
    ...(() => {
      const docs = documents({ source: { deviceUid: 'fixture-other-device' } })
      return [requestCase({ name: 'student-source-denies-device-spoofing', path: sourcePath, resource: docs[sourcePath], docs, expectation: 'DENY' })]
    })(),
    requestCase({ name: 'student-source-denies-stale-plan-revision', path: sourcePath, resource: source,
      docs: documents({ pageRevision: 8 }), expectation: 'DENY' }),
    requestCase({ name: 'student-source-denies-another-child', path: sourcePath, resource: source,
      docs: documents({ ownerChildId: 'fixture-other-child' }), expectation: 'DENY' }),
    requestCase({ name: 'student-source-denies-queue-receipt-mismatch', path: sourcePath, resource: {
      ...source, eventReceiptId: 'f'.repeat(64),
    }, docs: baseDocs, expectation: 'DENY' }),
    ...[
      { eventType: 'upload.bytes_uploaded', status: 'uploaded', operation: `upload-transfer:${fixture.uploadId}:uploaded` },
      { eventType: 'upload.delete_requested', status: 'deleted', operation: `upload-delete:${fixture.uploadId}` },
    ].map(({ eventType, status, operation }) => {
      const docs = documents({ source: { status, eventOperationId: operation }, event: { eventType, operationId: operation } })
      return requestCase({ name: `student-queue-event-allows-${eventType}`, path: eventPath, resource: docs[eventPath], docs })
    }),
    ...[
      { name: 'student-source-update-records-uploaded-with-queue-receipt', oldStatus: 'awaiting-upload',
        status: 'uploaded', eventType: 'upload.bytes_uploaded', operation: `upload-transfer:${fixture.uploadId}:uploaded` },
      { name: 'student-source-update-records-delete-with-queue-receipt', oldStatus: 'pending',
        status: 'deleted', eventType: 'upload.delete_requested', operation: `upload-delete:${fixture.uploadId}` },
    ].map(({ name, oldStatus, status, eventType, operation }) => {
      const oldSource = { ...source, status: oldStatus, ...(oldStatus === 'awaiting-upload' ? { upload: { href: 'https://disk.yandex.net/upload/opaque' } } : {}) }
      const sourceData = { ...oldSource, status, eventOperationId: operation,
        ...(status === 'deleted' ? { deletedAt: fixture.time } : {}) }
      const docs = documents({ source: sourceData, event: { eventType, operationId: operation } })
      return requestCase({ name, path: sourcePath, method: 'update', priorResource: oldSource, resource: sourceData, docs })
    }),
  ]
}

export const photoUploadRulesFixture = Object.freeze({ ...fixture })
