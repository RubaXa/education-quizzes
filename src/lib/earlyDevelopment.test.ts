/** @see ../../docs/modules/families/early-development.md */
import { describe, expect, it } from 'vitest'
import { JOURNAL_KEY, PROGRAM_VERSION, readObservations, suggestedActivities, writeObservations, type Observation } from './earlyDevelopment'
const entry: Observation = { id: 'episode', activityId: 'contrast', programVersion: PROGRAM_VERSION, observedAt: '2026-10-22T12:00:00Z', reaction: 'Отвернулась', note: 'Убрали картинку' }
describe('early development observations', () => {
  it('offers contact after disengagement without escalating or grading', () => {
    expect(suggestedActivities([entry]).items.map((item) => item.id)).toEqual(['voice', 'face', 'contrast'])
    expect(suggestedActivities([]).items).toHaveLength(3)
    expect(suggestedActivities([{ ...entry, reaction: 'Не заметили реакции' }]).items).toHaveLength(3)
  })
  it('uses actual time rather than array order and keeps a single episode separate from ability', () => {
    expect(suggestedActivities([{ ...entry, id: 'older', observedAt: '2026-10-21T12:00:00Z' }, { ...entry, id: 'newer', reaction: 'Смотрела' }]).items).toHaveLength(3)
  })
  it('round trips provenance and refuses corrupted data instead of overwriting it', () => {
    let data = ''
    writeObservations({ setItem: (key, value) => { expect(key).toBe(JOURNAL_KEY); data = value } }, [entry])
    expect(readObservations({ getItem: () => data })).toEqual([entry])
    expect(() => readObservations({ getItem: () => '[{"reaction":"bad"}]' })).toThrow()
    expect(() => readObservations({ getItem: () => 'broken' })).toThrow()
  })
})
