import { test, expect } from 'vitest'
import { createPhotoUploadRulesTestSuite, photoUploadRulesFixture } from '../rules-test-fixtures/photo-upload-suite.mjs'

/** @see ../docs/modules/materials/storage-privacy.md#upload-queue */
test('synthetic Rules REST suite covers atomic photo queue writes and ownership boundaries', () => {
  const cases = createPhotoUploadRulesTestSuite()
  expect(photoUploadRulesFixture.uid).toMatch(/^fixture-/)
  expect(cases.map(({ name }) => name)).toEqual(expect.arrayContaining([
    'student-source-create-with-event-receipt',
    'student-queue-event-create-with-atomic-source',
    'student-queue-event-allows-upload.bytes_uploaded',
    'student-queue-event-allows-upload.delete_requested',
    'queue-event-denies-malformed-source-path',
    'queue-event-denies-unlinked-child',
    'queue-event-denies-actor-uid-spoofing',
    'student-source-denies-parent-role',
    'student-source-denies-task-outside-published-page',
    'student-source-denies-stale-plan-revision',
  ]))
  expect(cases.every(({ resource, request, functionMocks }) => (request.method === 'create' ? resource === null : Boolean(resource?.data))
    && ['create', 'update'].includes(request.method) && request.resource?.data && functionMocks.length > 0)).toBe(true)
  expect(cases.filter(({ request }) => request.method === 'update')).toHaveLength(2)
  expect(cases.filter(({ expectation }) => expectation === 'DENY')).toHaveLength(14)
})
