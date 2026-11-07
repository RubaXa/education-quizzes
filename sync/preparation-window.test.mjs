import { describe, expect, it } from 'vitest'
import { preparationExpiry, ensureContinuousPreparation, preparationVisible } from './preparation-window.mjs'

it('publishes the same course sheet from first availability, retains it on weekdays and after a week boundary', () => {
  const source = { targetDate: '2026-11-12', subjects: [{ name: 'Спецкурс по математике', tasks: [{ id: 'sheet', problems: [{ id: 'p1' }] }] }] }
  expect(ensureContinuousPreparation(source, '2026-11-07')).toBe(true)
  expect(source.weekendSlot.preparationThrough).toBe('2026-11-10')
  expect(preparationVisible(source.weekendSlot, '2026-11-06')).toBe(false)
  for (const date of ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-16']) expect(preparationVisible(source.weekendSlot, date)).toBe(true)
  expect(ensureContinuousPreparation(source, '2026-11-09')).toBe(false)
  expect(source.weekendSlot.availableFrom).toBe('2026-11-07')
})
it('does not confuse notebook hand-in with course work or rewrite a legacy weekend', () => {
  const source = { targetDate: '2026-11-11', subjects: [{ name: 'Практикум по решению математических задач', tasks: [{ id: 'hand-in', kind: 'check' }] }] }
  expect(ensureContinuousPreparation(source, '2026-11-07')).toBe(false)
  expect(preparationVisible({ dates: ['2026-11-07', '2026-11-08'] }, '2026-11-09')).toBe(false)
})
/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
const window = ['2026-11-02', '2026-12-13']
describe('moving weekly preparation window', () => {
  it('archives last week, retaining Monday and the entire current week', () => {
    expect(preparationExpiry({kind:'enrich-task',source:{date:'2026-10-30'}},window)).toContain('active-from:2026-11-02')
    for (const date of ['2026-11-02','2026-11-03','2026-11-09']) expect(preparationExpiry({kind:'material-needed',source:{date}},window)).toBeNull()
  })
  it('never expires attempts, help, event actions or unknown source dates', () => {
    for (const kind of ['review-work','review-quiz','triage-help','repair-review','prepare-targeted-followup'])
      expect(preparationExpiry({kind,source:{date:'2026-10-20'}},window)).toBeNull()
    expect(preparationExpiry({kind:'enrich-task',artifactPath:'operatorSyncTaskArtifacts/id',source:{date:'2026-10-20'}},window)).toBeNull()
    expect(preparationExpiry({kind:'enrich-task',source:{}},window)).toBeNull()
  })
})
