import { describe, expect, it } from 'vitest'
import { clarificationAudioPageError, sourceMaterialAudioTaskIds } from './audio-selection-plan.mjs'

describe('private per-day audio selections', () => {
  const source = { subjects: [{ tasks: [{ id: 'mesh-repeat' }, { id: 'mesh-written' }] }] }
  it('requires nonempty arrays for exact current task IDs and reads one clarification per task', () => {
    expect(sourceMaterialAudioTaskIds(source, { 'mesh-repeat': [
      { evidence: { kind: 'source-material' } }, { evidence: { kind: 'mesh' } },
    ] })).toEqual(['mesh-repeat'])
    expect(sourceMaterialAudioTaskIds(source, { 'mesh-repeat': [{ evidence: { kind: 'source-material', ref: 'same-upload' } }],
      'mesh-written': [{ evidence: { kind: 'source-material', ref: 'same-upload' } }] })).toEqual(['mesh-repeat', 'mesh-written'])
    expect(() => sourceMaterialAudioTaskIds(source, { unknown: [{ evidence: { kind: 'mesh' } }] })).toThrow(/существующего задания/)
    expect(() => sourceMaterialAudioTaskIds(source, { 'mesh-repeat': [] })).toThrow(/непустым списком/)
    expect(() => sourceMaterialAudioTaskIds(source, { 'mesh-repeat': {} })).toThrow(/непустым списком/)
    expect(() => sourceMaterialAudioTaskIds(source, [])).toThrow(/объектом/)
  })
  it('checks local owner date separately from target lesson date and exact student page provenance', () => {
    const context = { date: '2026-10-22', targetDate: '2026-10-23', familyId: 'family-a', childId: 'child-a' }
    const owner = { familyId: 'family-a', childId: 'child-a', date: '2026-10-22', targetDate: '2026-10-23' }
    const page = { kind: 'student', familyId: 'family-a', childId: 'child-a', date: '2026-10-22', targetDate: '2026-10-23', planRevision: 4 }
    expect(clarificationAudioPageError({ ...context, owner, page })).toBeNull()
    expect(clarificationAudioPageError({ ...context, owner: { ...owner, date: '2026-10-23' }, page })).toMatch(/страницы/)
    expect(clarificationAudioPageError({ ...context, owner, page: { ...page, familyId: 'foreign' } })).toMatch(/страницы/)
    expect(clarificationAudioPageError({ ...context, owner, page: { ...page, date: '2026-10-23' } })).toMatch(/страницы/)
  })
})
