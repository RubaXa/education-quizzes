import { describe, expect, it } from 'vitest'
import { taskRoute, taskRouteCandidates, eventTaskRoute } from './task-route.mjs'

const unresolved = { id: 'mesh-123', meshText: 'р.т. стр.15–16', sourceOnly: true,
  instructionStatus: { state: 'needs-review' }, materialStatus: { state: 'textbook-page-needed' } }
const request = { id: 'book-pages', state: 'open', question: 'Пришли страницы 15 и 16.', photoPrompt: 'Обе страницы целиком с номерами.' }
const ready = { id: 'mesh-456', meshText: 'Упр.4 письменно', kind: 'written',
  instructionStatus: { state: 'reviewed' }, materialStatus: { state: 'textbook-page-linked' } }

describe('deterministic task route from existing source state', () => {
  it.each([undefined, 'home', 'competition'])('reviews home practice even when the printed source has a future deadline (%s)', practiceMode => {
    const task = { ...ready, practiceMode, competitionUntil: '2026-11-05T23:59:59.000Z' }
    expect(taskRoute(task, 'math').next).toBe('prepare-written-guidance')
    expect(eventTaskRoute('upload.confirmed', {context:{task}}).next).toBe('review-written-work')
    expect(eventTaskRoute('help.requested', {context:{task}}).next).toBe('address-help-request')
  })
  it.each([1, 2, 3, 4, 5, 6, 7])('reviews every uploaded task %s despite printed competition metadata', competitionNumber => {
    const task = { ...ready, practiceMode: 'competition', competitionNumber, competitionUntil: '2026-11-05T23:59:59.000Z' }
    expect(eventTaskRoute('upload.confirmed', {context:{task}}).next).toBe('review-written-work')
    expect(eventTaskRoute('help.requested', {context:{task}}).next).toBe('address-help-request')
    expect(eventTaskRoute('upload.confirmed', {context:{task:{...task,competitionUntil:'unknown'}}}).next).toBe('review-written-work')
  })
  it('requires both operator reviews before mathematical guidance publication without declaring understanding or completion',()=>{
    const route=taskRoute(ready,'math')
    expect(route.policyRevision).toBe('personal-step-explanations-2026-10-30')
    expect(route.steps).toContain('adult-readable-class-level-route-review')
    expect(route.steps).toContain('learner-current-point-and-safe-hint-review')
    const event=eventTaskRoute('help.requested',{context:{subject:'Спецкурс по математике',task:ready}})
    expect(event.policyRevision).toBe(route.policyRevision)
    expect(event.steps.indexOf('learner-current-point-and-safe-hint-review')).toBeLessThan(event.steps.indexOf('publish-support-revision'))
    expect(event.complete).toBe(false)
  })
  it('cannot leave missing textbook pages as a bare operator block', () => {
    expect(taskRoute(unresolved, 'english')).toMatchObject({ next: 'recover-source', unknown: ['exact-material'],
      steps: ['family-source-lookup', 'exact-edition-web-lookup', 'publish-student-material-request', 'await-source-upload'], complete: false })
    expect(taskRouteCandidates(unresolved)).toContain('material-needed')
  })
  it('waits for a valid published request without inventing a quiz or re-requesting it', () => {
    const task = { ...unresolved, materialRequest: request, assessmentIntent: { state: 'needs-topic' } }
    expect(taskRoute(task, 'english')).toMatchObject({ next: 'await-source-upload', complete: false })
    expect(taskRouteCandidates(task)).not.toContain('material-needed')
    expect(taskRoute({ ...task, materialRequest: { ...request, photoPrompt: '' } }).next).toBe('recover-source')
  })
  it('continues from verified student pages without demanding a full textbook PDF', () => {
    const task = { ...ready, materialStatus: { state: 'no-textbook', message: 'Полный PDF отсутствует, страница сверена по фото.' },
      materialRequest: { ...request, state: 'resolved', resolvedTopic: 'Упр.4, страница31: письменная таблица', uploadIds: ['page-upload'] } }
    expect(taskRouteCandidates(task)).toEqual([])
    expect(taskRoute(task, 'english').next).toBe('prepare-written-guidance')
    expect(taskRoute({ ...task, instructionStatus: { state: 'needs-review' } }).next).toBe('recover-source')
  })
  it.each(['math', 'special', 'russian', 'literature', 'english', 'history', 'geography', 'biology', 'technology'])('preserves subject routing for %s', subject => {
    const route = taskRoute(ready, subject)
    expect(route.subject).toBe(subject)
    expect(route.next).toBe('prepare-written-guidance')
    expect(route.complete).toBe(false)
  })
  it('uses the existing assessment graph for confirmed reading and blocks unknown control topics', () => {
    expect(taskRoute({ ...ready, kind: 'read', outputKind: 'reading', meshText: 'Прочитай §36' }, 'geography').next).toBe('prepare-quiz')
    expect(taskRoute({ ...ready, kind: 'check', meshText: 'Подготовиться к контрольной' }, 'russian').next).toBe('classify-assignment')
  })
  it('does not call an existing quiz or known source completed school work', () => {
    expect(taskRoute({ ...ready, testToken: 'private-token' }).next).toBe('existing-assessment')
    expect(JSON.stringify(taskRoute({ ...ready, testToken: 'private-token' }))).not.toContain('private-token')
  })
  it('prioritizes an unresolved source over a stale quiz link and preserves completed platform work', () => {
    expect(taskRoute({ ...unresolved, testToken: 'old' }).next).toBe('recover-source')
    expect(taskRoute({ ...ready, platformResult: { state: 'completed' } }).next).toBe('platform-result-confirmed')
  })
  it('routes learner-submitted olympiad conditions separately from solved work', () => {
    const task = { ...ready, optional: true, learningContext: { kind: 'olympiad', id: 'o1' }, sourceIntake: { kind: 'olympiad-sheet' } }
    const route = eventTaskRoute('upload.confirmed', { context: { subject: 'Математика', task } })
    expect(route.next).toBe('ingest-olympiad-sheet')
    expect(route.steps).toContain('verify-source-and-solution')
    expect(route.steps.indexOf('identify-uploaded-material-context')).toBeLessThan(route.steps.indexOf('verify-source-and-solution'))
    expect(route.complete).toBe(false)
    expect(eventTaskRoute('upload.confirmed', { context: { task: { ...task, optional: false } } }).next).toBe('review-written-work')
    expect(eventTaskRoute('upload.confirmed', { context: { task: { ...task, learningContext: { kind: 'homework' } } } }).next).toBe('review-written-work')
    expect(eventTaskRoute('help.requested', { context: { task } }).next).toBe('address-help-request')
  })
  it('reviews submitted practice despite printed competition dates', () => {
    const task = { ...ready, competitionUntil: '2999-01-01T00:00:00.000Z', learningContext: { kind: 'olympiad', id: 'contest' } }
    for (const type of ['upload.confirmed', 'help.requested']) {
      const route = eventTaskRoute(type, { context: { subject: 'Математика', task } })
      expect(route.next).toBe(type === 'upload.confirmed' ? 'review-written-work' : 'address-help-request')
      expect(route.steps).not.toContain('wait-for-competition-close')
    }
  })
  it('routes a requested page upload to source analysis, never to a homework grade', () => {
    expect(eventTaskRoute('upload.confirmed', { source: { purpose: 'source-material' }, context: { subject: 'Английский язык', task: ready } }).next).toBe('review-source-material')
    expect(eventTaskRoute('upload.confirmed', { source: {}, context: { task: { ...unresolved, materialRequest: request, assessmentIntent: { state: 'needs-topic' } } } }).next).toBe('review-source-material')
    expect(eventTaskRoute('upload.confirmed', { source: {}, context: { task: ready } }).next).toBe('review-written-work')
  })
  it.each(['quiz.submitted', 'quiz.followup_requested', 'help.requested', 'material.ready'])('has an explicit branch for %s', type => {
    expect(eventTaskRoute(type, {}).next).not.toBe('unsupported-event')
  })
  it('keeps unknown events visible, never silently completed', () => {
    expect(eventTaskRoute('new.unhandled', {})).toMatchObject({ next: 'unsupported-event', complete: false })
  })
})
