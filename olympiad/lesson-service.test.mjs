import { describe, expect, it } from 'vitest'
import { createLessonService } from './lesson-service.mjs'

const scope = { familyId: 'family', childId: 'child', olympiadId: 'olympiad', attemptId: 'attempt' }
const lesson = { id: 'lesson', version: '1', topicId: 'topic', title: 'Урок', steps: [{ id: 'step', prompt: 'Вопрос', options: [{ id: 'a', text: 'А' }, { id: 'b', text: 'Б' }], correctOptionIds: ['b'], correctExplanation: 'Верно', incorrectHint: 'Проверь условие' }] }
const ref = { lessonId: 'lesson', version: '1' }
const command = { id: 'cmd', at: '2026-10-27T12:00:00Z', type: 'answer', optionId: 'a' }
function fixture() {
  let record = null
  let allowed = true
  let conflicts = 0
  let reads = 0
  const service = createLessonService({
    authorizeLesson: async () => true,
    authorize: async (principal, subject) => allowed && principal === 'member' && subject.familyId === 'family' && subject.childId === 'child',
    readAttempt: async () => { reads++; return record },
    readLesson: async () => lesson,
    compareAndSwap: async ({ expectedRevision, attempt }) => {
      if (!allowed) throw new Error('Denied by storage')
      if (conflicts > 0) { conflicts--; return false }
      if ((record?.revision ?? null) !== expectedRevision) return false
      record = { attempt, revision: (record?.revision ?? -1) + 1 }
      return true
    },
  })
  return { service, deny: () => { allowed = false }, conflict: () => { conflicts++ }, reads: () => reads, record: () => record }
}

describe('server lesson service', () => {
  it('fails closed when source permissions are unavailable or withdrawn', async () => {
    expect(() => createLessonService({ authorize: async () => true, readAttempt: async () => null, readLesson: async () => lesson, compareAndSwap: async () => true })).toThrow('Invalid lesson ports')
    let allowed = true
    const f = fixture(); await f.service.start('member', scope, ref)
    const service = createLessonService({ authorize: async () => true, authorizeLesson: async () => allowed, readAttempt: async () => f.record(), readLesson: async () => lesson, compareAndSwap: async () => true })
    await service.view('member', scope)
    allowed = false
    await expect(service.view('member', scope)).rejects.toThrow('unavailable')
    await expect(service.act('member', scope, command)).rejects.toThrow('unavailable')
  })
  it('enforces membership before reading, acting and retrying', async () => {
    const f = fixture()
    await expect(f.service.view('stranger', scope)).rejects.toThrow('unavailable')
    expect(f.reads()).toBe(0)
    await f.service.start('member', scope, ref)
    await expect(f.service.act('member', { ...scope, childId: 'other' }, command)).rejects.toThrow('unavailable')
    await f.service.act('member', scope, command)
    f.deny()
    await expect(f.service.act('member', scope, command)).rejects.toThrow('unavailable')
    await expect(f.service.view('member', scope)).rejects.toThrow('unavailable')
  })
  it('retries conflicting writes without duplicating events and omits private keys', async () => {
    const f = fixture()
    await f.service.start('member', scope, ref)
    f.conflict()
    const result = await f.service.act('member', scope, command)
    await f.service.act('member', scope, command)
    expect(f.record().attempt.events).toHaveLength(1)
    expect(result.feedback.text).toBe('Проверь условие')
    expect(JSON.stringify(result)).not.toContain('correctOptionIds')
    expect(JSON.stringify(result)).not.toContain('correctExplanation')
  })
  it('rejects a record whose child is different even if storage returns it', async () => {
    const f = fixture()
    await f.service.start('member', scope, ref)
    f.record().attempt.childId = 'someone-else'
    await expect(f.service.view('member', scope)).rejects.toThrow('unavailable')
  })
  it('rechecks authorization before delivering a projection', async () => {
    const f = fixture()
    await f.service.start('member', scope, ref)
    let checks = 0
    const service = createLessonService({
      authorize: async () => ++checks === 1, authorizeLesson: async () => true,
      readAttempt: async () => f.record(), readLesson: async () => lesson,
      compareAndSwap: async () => { throw new Error('unexpected') },
    })
    await expect(service.view('member', scope)).rejects.toThrow('unavailable')
  })
})
