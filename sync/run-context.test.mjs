import { describe, expect, it } from 'vitest'
import { reuseRunContext } from './run-context.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncDiary } from '../diary/application/sync.mjs'

describe('one child source context per collection', () => {
  it('preserves the complete persisted diary model across 42 actual syncDate calls', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'education-run-context-'))
    const marks = [{ id: 'mark', value: 5, comment: 'Teacher comment', controlFormName: 'Практическая работа' }]
    const makeAdapter = () => ({ getProfile: async () => ({ childId: 'child' }), getMarks: async () => marks,
      getSchedule: async (date) => [{ date, subject: 'math' }],
      getAssignments: async (date) => [{ date, detailStatus: 'loaded', descriptions: ['№ 1'] }] })
    try {
      const cached = reuseRunContext(makeAdapter())
      const normal = makeAdapter()
      for (let index = 0; index < 42; index++) {
        const date = new Date(Date.UTC(2026, 9, 12 + index)).toISOString().slice(0, 10)
        const first = await syncDiary({ adapter: normal, dataDir: join(directory, 'normal'), date })
        const second = await syncDiary({ adapter: cached, dataDir: join(directory, 'cached'), date })
        expect({ ...second, fetchedAt: first.fetchedAt }).toEqual(first)
        expect(second.complete).toBe(true)
        expect(second.marks[0].comment).toBe('Teacher comment')
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('loads the same profile and full grade journal once across 42 dates', async () => {
    const calls = { profile: 0, marks: 0, schedule: 0 }
    const reused = []
    const profile = { id: 'one-child' }, marks = [{ id: 'mark-1', comment: 'preserved' }]
    const adapter = reuseRunContext({
      getProfile: async () => { calls.profile++; return profile },
      getMarks: async () => { calls.marks++; return marks },
      getSchedule: async (date) => { calls.schedule++; return [{ date }] },
    }, (method) => reused.push(method))
    for (let date = 0; date < 42; date++) {
      expect(await adapter.getProfile()).toEqual(profile)
      expect(await adapter.getMarks()).toEqual(marks)
      expect(await adapter.getSchedule(date)).toEqual([{ date }])
    }
    expect(calls).toEqual({ profile: 1, marks: 1, schedule: 42 })
    expect(reused.filter((method) => method === 'getProfile')).toHaveLength(41)
  })

  it('does not retain failed calls or share values between children/runs', async () => {
    let calls = 0
    const first = reuseRunContext({ getProfile: async () => {
      if (++calls === 1) throw new Error('temporary')
      return { id: 'first' }
    }, getMarks: async () => [] })
    await expect(first.getProfile()).rejects.toThrow('temporary')
    expect(await first.getProfile()).toEqual({ id: 'first' })
    expect(calls).toBe(2)
    const second = reuseRunContext({ getProfile: async () => ({ id: 'second' }), getMarks: async () => [] })
    expect(await second.getProfile()).toEqual({ id: 'second' })
  })
})
