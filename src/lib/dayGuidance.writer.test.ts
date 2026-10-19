import { beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ freshGuide: null as any, batchSets: [] as Array<{ ref: { path: string }; data: Record<string, unknown> }>, batches: [] as Array<Array<{ ref: { path: string }; data: Record<string, unknown> }>>, commits: 0 }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'parent-device' } }) }))
vi.mock('./personalAccess', () => ({ currentEducationPersonId: () => 'parent-person' }))
vi.mock('./educationEventProducer', () => ({
  prepareEducationEvent: async (input: Record<string, unknown>) => ({ ...input, eventId: 'prepared-event' }),
  stagePreparedEducationEvent: (batch: { set: (ref: { path: string }, data: Record<string, unknown>) => void }, event: { eventId: string }) => {
    batch.set({ path: `educationEvents/${event.eventId}` }, event as unknown as Record<string, unknown>)
  },
}))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDocFromServer: async (ref: { path: string }) => ({ exists: () => true, data: () => ref.path.startsWith('dayTaskGuides/')
    ? { guide: probe.freshGuide } : { familyId: 'family', childId: 'child', targetDate: '2026-10-19' } }),
  getDocs: async () => ({ docs: [{ id: 'learner', data: () => ({ active: true, role: 'student', childIds: ['child'] }) }] }),
  onSnapshot: vi.fn(), serverTimestamp: () => 'server-time',
  writeBatch: () => {
    const writes: Array<{ ref: { path: string }; data: Record<string, unknown> }> = []
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => { const write = { ref, data }; writes.push(write); probe.batchSets.push(write) },
      commit: async () => { probe.commits += 1; probe.batches.push([...writes]) },
    }
  },
}))

import { sendDayGuidance } from './dayGuidance'
import type { ParentTaskGuide } from './dayStore'

const guide: ParentTaskGuide = { kind: 'worked-solution', presentation: 'math-route', revision: 3, overview: 'guide', stages: [{
  id: 'given', title: 'Прямая и направления', role: 'calculation', expected: 'Переходы ±1, ±2, ±4, ±8, ±16 дм',
  why: 'Парные переходы равны.',
  // Optional row keys are kept exactly when present and omitted when absent.
  rows: [
    { label: 'Симметрия', value: 'Можно считать последний переход равным +16' },
    { value: 'Проверка', explanation: 'Сопоставь обратные направления.' },
  ],
  hintPreview: 'Сравни направления.', revealPreview: 'Полное объяснение этапа.',
  source: { kind: 'teacher-file', label: 'Лист учителя №2', ref: 'private-ref', excerpt: 'private-excerpt' },
}] }

beforeEach(() => { probe.freshGuide = structuredClone(guide); probe.batchSets.length = 0; probe.batches.length = 0; probe.commits = 0 })

describe('day guidance writer', () => {
  it('writes hint prose only and a distinct full reveal with the selected public projection', async () => {
    await sendDayGuidance('student-token', 'task', guide, 'given', 'hint')
    const hint = probe.batchSets.find((item) => item.ref.path.startsWith('dayGuidance/'))!
    expect(hint.data).toMatchObject({ level: 'hint', text: 'Сравни направления.' })
    expect(hint.data).not.toHaveProperty('revealContent')
    const hintId = hint.ref.path.split('/').at(-1)

    probe.batchSets.length = 0
    await sendDayGuidance('student-token', 'task', guide, 'given', 'reveal')
    const reveal = probe.batchSets.find((item) => item.ref.path.startsWith('dayGuidance/'))!
    expect(reveal.data).toMatchObject({ level: 'reveal', text: 'Полное объяснение этапа.', revealContent: {
      title: 'Прямая и направления', expected: 'Переходы ±1, ±2, ±4, ±8, ±16 дм',
      rows: [
        { label: 'Симметрия', value: 'Можно считать последний переход равным +16' },
        { value: 'Проверка', explanation: 'Сопоставь обратные направления.' },
      ],
      role: 'calculation', why: 'Парные переходы равны.', answer: '', verification: [], sourceLabel: 'Лист учителя №2',
    } })
    expect(JSON.stringify(reveal.data)).not.toMatch(/private-ref|private-excerpt/)
    expect(reveal.ref.path.split('/').at(-1)).not.toBe(hintId)
    expect(probe.commits).toBe(2)
    const lastBatch = probe.batches.at(-1)!
    expect(lastBatch.map((write) => write.ref.path)).toEqual([
      reveal.ref.path,
      'users/learner/inbox/' + reveal.ref.path.split('/').at(-1),
      'educationEvents/prepared-event',
    ])
    expect(reveal.data.eventReceiptId).toBe('prepared-event')
    expect(lastBatch[2].data).toMatchObject({ eventType: 'parent.guidance_sent', operationId: reveal.ref.path.split('/').at(-1) })
  })

  it('rejects a same-revision change to the selected stage before writing', async () => {
    probe.freshGuide.stages[0].rows[0].value = 'Changed row'
    await expect(sendDayGuidance('student-token', 'task', guide, 'given', 'reveal')).rejects.toThrow('Разбор изменился')
    expect(probe.commits).toBe(0)
    expect(probe.batchSets).toHaveLength(0)
  })

  it('uses selected reveal content in the immutable ID when prose and revision stay the same', async () => {
    await sendDayGuidance('student-token', 'task', guide, 'given', 'reveal')
    const firstId = probe.batchSets.find((item) => item.ref.path.startsWith('dayGuidance/'))!.ref.path.split('/').at(-1)
    const changedGuide = structuredClone(guide)
    changedGuide.stages[0].rows![0].value = 'A newly reviewed row with unchanged prose.'
    probe.freshGuide = structuredClone(changedGuide)
    probe.batchSets.length = 0
    await sendDayGuidance('student-token', 'task', changedGuide, 'given', 'reveal')
    const secondId = probe.batchSets.find((item) => item.ref.path.startsWith('dayGuidance/'))!.ref.path.split('/').at(-1)
    expect(secondId).not.toBe(firstId)
  })
})
