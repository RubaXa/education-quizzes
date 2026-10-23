import { describe, expect, it } from 'vitest'
import { taskRoute, taskRouteCandidates, eventTaskRoute } from './task-route.mjs'

const unresolved = { id: 'mesh-123', meshText: 'р.т. стр.15–16', sourceOnly: true,
  instructionStatus: { state: 'needs-review' }, materialStatus: { state: 'textbook-page-needed' } }
const request = { id: 'book-pages', state: 'open', question: 'Пришли страницы 15 и 16.', photoPrompt: 'Обе страницы целиком с номерами.' }
const ready = { id: 'mesh-456', meshText: 'Упр.4 письменно', kind: 'written',
  instructionStatus: { state: 'reviewed' }, materialStatus: { state: 'textbook-page-linked' } }

describe('deterministic task route from existing source state', () => {
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
