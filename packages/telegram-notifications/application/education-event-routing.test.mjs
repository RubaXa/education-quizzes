import { describe, expect, it, vi } from 'vitest'
import { createEducationEventHandlers } from './education-event-routing.mjs'

const base = { eventId: 'a'.repeat(64), source: 'firestore', familyId: 'family-a', childId: 'child-a',
  actor: { type: 'user', uid: 'parent-a' }, operationId: 'op-a' }

describe('unified education event routing', () => {
  it('refreshes preparation before source observation and requires its durable handler',async()=>{
    const update=vi.fn(async()=>({state:'complete'}))
    const routes=createEducationEventHandlers({actionHandlers:{'review.published':update,'parent.decision':update}})
    for(const eventType of ['review.published','parent.decision']){
      expect(routes[eventType][0].phase).toBe('olympiad-preparation')
      await routes[eventType][0].handle({...base,eventType});expect(update).toHaveBeenCalledWith({...base,eventType},undefined)
    }
    expect(await createEducationEventHandlers()['review.published'][0].handle({...base,eventType:'review.published'})).toMatchObject({state:'blocked'})
  })
  it('uses exact upload, review, and quiz source references for source observation', async () => {
    const process = vi.fn(async () => ({ status: 'advanced' }))
    const handlers = createEducationEventHandlers({ firestorePipeline: { process } })
    for (const [eventType, sourceRef, expected] of [
      ['upload.confirmed', { kind: 'upload', documentPath: 'dayUploads/day-a/files/file-a' },
        { kind: 'upload', familyId: 'family-a', childId: 'child-a', dayToken: 'day-a', recordId: 'file-a' }],
      ['review.published', { kind: 'review', documentPath: 'dayProgress/day-b/items/task-b' },
        { kind: 'progress', familyId: 'family-a', childId: 'child-a', dayToken: 'day-b', recordId: 'task-b' }],
      ['quiz.submitted', { kind: 'quiz', documentPath: 'assignments/quiz-c' },
        { kind: 'quiz', familyId: 'family-a', childId: 'child-a', quizToken: 'quiz-c' }],
      ['quiz.started', { kind: 'quiz', documentPath: 'assignments/quiz-c' },
        { kind: 'quiz', familyId: 'family-a', childId: 'child-a', quizToken: 'quiz-c' }],
    ]) {
      const event = { ...base, eventType, sourceRef }
      await handlers[eventType].find(p=>p.phase==='source-observation').handle(event)
      expect(process).toHaveBeenLastCalledWith(expected, { origin: 'live' })
    }
  })

  it('routes requested EducationSync work by typed action and never starts work for completed guidance', async () => {
    const enqueueAction = vi.fn(async () => ({ status: 'accepted', nextDueAt: '2026-10-19T10:00:00.000Z' }))
    const wake = vi.fn()
    const handlers = createEducationEventHandlers({ educationSyncDispatcher: { enqueueAction }, onEducationSyncQueued: wake })
    for (const eventType of ['help.requested', 'quiz.followup_requested', 'quiz.submitted', 'upload.confirmed', 'material.ready']) {
      const event = { ...base, eventType, sourceRef: { kind: 'quiz', documentPath: 'assignments/quiz-a' } }
      const action = handlers[eventType].find((item) => item.phase === 'education-sync-action')
      await action.handle(event)
      expect(enqueueAction).toHaveBeenLastCalledWith(event)
    }
    expect(wake).toHaveBeenCalledTimes(5)
    const guidance = handlers['parent.guidance_sent']
    expect(guidance.map(({ phase }) => phase)).toEqual(['completed-action-receipt'])
    expect(enqueueAction).toHaveBeenCalledTimes(5)
  })

  it('sends Mesh-normalized events through NotificationService and wakes durable delivery', async () => {
    const accept = vi.fn(async () => ({ created: true, queued: 1, nextDueAt: '2026-10-19T10:00:00.000Z' }))
    const wake = vi.fn()
    const handlers = createEducationEventHandlers({ notificationService: { accept }, onDeliveryQueued: wake })
    const event = { ...base, source: 'mesh', eventType: 'grade.created', payload: { scopeKey: 'b'.repeat(64),
      sourceEventKey: 'c'.repeat(64), sourceRevision: 'd'.repeat(64), detectedAt: '2026-10-19T10:00:00.000Z',
      privacyClass: 'family-summary', fields: { title: 'Проверочная' } } }
    await handlers['grade.created'].find((item) => item.phase === 'telegram-notification').handle(event)
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ source: 'mesh', eventType: 'grade.created',
      familyId: 'family-a', childId: 'child-a', fields: { title: 'Проверочная' } }))
    expect(wake).toHaveBeenCalledOnce()
  })

  it('does not turn probes or review notices into EducationSync work', async () => {
    const enqueueMeshChange = vi.fn(async () => ({ status: 'accepted' }))
    const accept = vi.fn(async () => ({ created: false, queued: 0 }))
    const handlers = createEducationEventHandlers({ educationSyncDispatcher: { enqueueMeshChange }, notificationService: { accept } })
    for (const eventType of ['technical.probe', 'review.changed', 'quiz.started']) {
      const event = { ...base, source: 'mesh', eventType, payload: { scopeKey: 'b'.repeat(64),
        sourceEventKey: 'c'.repeat(64), sourceRevision: 'd'.repeat(64), fields: {} } }
      for (const item of handlers[eventType]) await item.handle(event)
    }
    expect(enqueueMeshChange).not.toHaveBeenCalled()
    expect(accept).toHaveBeenCalledTimes(3)
  })

  it('requires an exact injected server action handler for transfer requests', async () => {
    const missing = createEducationEventHandlers()
    const event = { ...base, eventType: 'upload.transfer_requested' }
    await expect(missing[event.eventType][0].handle(event)).resolves.toEqual({ state: 'blocked', safeErrorCode: 'server_action_handler_unavailable' })
    const transfer = vi.fn(async () => ({ state: 'complete' }))
    const handlers = createEducationEventHandlers({ actionHandlers: { 'upload.transfer_requested': transfer } })
    await handlers[event.eventType][0].handle(event)
    expect(transfer).toHaveBeenCalledWith(event, undefined)
  })
})
