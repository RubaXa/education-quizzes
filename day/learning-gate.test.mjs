/** @see ../docs/modules/assignments/README.md#readiness-and-handover */
import { expect, it } from 'vitest'
import { learningGate } from './learning-gate.mjs'
it('does not mistake a published demo or assisted success for readiness', () => {
  expect(learningGate({ prepared: true, readinessRequired: true })).toMatchObject({ readiness: 'not-confirmed', operatorMayClosePublishedPreparation: true })
  expect(learningGate({ prepared: true, readinessRequired: true, independentCheck: { reviewed: true, independent: false, passed: true } }).readiness).toBe('not-confirmed')
  expect(learningGate({ readinessRequired: true, independentCheck: { reviewed: true, independent: true, passed: true } }).readiness).toBe('not-confirmed')
  expect(learningGate({ readinessRequired: true, independentCheck: { reviewed: true, independent: true, passed: true, coversAssignedScope: true, evidenceRef: 'reviewed-attempt' } }).readiness).toBe('confirmed')
})
it('keeps all ten credits when the teacher reports missing homework', () => {
  const requiredIds = Array.from({ length: 10 }, (_, i) => `p${i}`)
  expect(learningGate({ prepared: true, requiredIds, reviews: requiredIds.map(taskId => ({ taskId, status: 'verified' })), schoolDebt: true })).toMatchObject({ work: 'verified', handover: 'teacher-not-received', next: 'locate-and-hand-in-existing-work', missingIds: [], preserveCredit: true })
})
it('checks existing photos first and asks only about unconfirmed parts', () => {
  expect(learningGate({ requiredIds: ['a', 'b'], reviews: [{ taskId: 'a', status: 'verified' }], pendingUploadIds: ['photo'] })).toMatchObject({ next: 'review-existing-uploads', verifiedIds: ['a'], missingIds: ['b'] })
  expect(learningGate({ requiredIds: ['a', 'b'], reviews: [{ taskId: 'a', status: 'verified' }] })).toMatchObject({ next: 'locate-existing-work-before-requesting-more', missingIds: ['b'] })
})
