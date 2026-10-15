import { describe, expect, it, vi } from 'vitest'
import { stageGradeProjectionForRole } from './grade-publication.mjs'

const detailed = { gradeSummary: [{ id: 'math', average: 4.5 }], gradeAsOf: '2026-10-14',
  grades: [{ id: 'math', name: 'Математика', displayed_average: 4.5,
    grades: [{ mark: 5, weight: 1, sourceId: '11', comment: 'Проверено' }] }], workingThreshold: 4.55 }
const links = { '2026-10-14': { parent: 'parent-14', student: 'student-14' },
  '2026-10-15': { parent: 'parent-15', student: 'student-15' } }
const owner = { familyId: 'family-1', childId: 'child-1' }

describe('сквозная публикация подробностей оценок', () => {
  it('дополняет только устаревший день, в обеих ролях, и не повторяет неизменную запись', async () => {
    const pages = Object.fromEntries(Object.values(links).flatMap((pair) => Object.entries(pair).map(([role, token]) =>
      [token, { ...owner, kind: role, ...detailed, grades: token.endsWith('15')
        ? [{ ...detailed.grades[0], grades: [{ mark: 5, weight: 1 }] }] : detailed.grades }])))
    const read = vi.fn(async (token) => pages[token])
    const write = vi.fn(async (token, patch) => Object.assign(pages[token], patch))
    for (const role of ['parent', 'student']) {
      const updated = await stageGradeProjectionForRole({ role, links, owner, fingerprint: 'rich-v1',
        previousFingerprint: null, desired: detailed, loadPage: read, stagePatch: write })
      expect(updated).toEqual([`${role}-15`])
    }
    expect(write).toHaveBeenCalledTimes(2)
    expect(pages['parent-15'].grades).toEqual(detailed.grades)
    expect(pages['student-15'].grades).toEqual(detailed.grades)
    read.mockClear(); write.mockClear()
    for (const role of ['parent', 'student']) {
      expect(await stageGradeProjectionForRole({ role, links, owner, fingerprint: 'rich-v1',
        previousFingerprint: 'rich-v1', desired: detailed, loadPage: read, stagePatch: write })).toEqual([])
    }
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('останавливает потерю уже опубликованных комментариев при неполном новом журнале', async () => {
    const page = { ...owner, kind: 'parent', ...detailed }
    const write = vi.fn()
    await expect(stageGradeProjectionForRole({ role: 'parent', links: { '2026-10-14': links['2026-10-14'] }, owner,
      fingerprint: 'short-v2', previousFingerprint: 'rich-v1', desired: { ...detailed,
        grades: [{ ...detailed.grades[0], grades: [{ mark: 5, weight: 1 }] }] },
      loadPage: async () => page, stagePatch: write })).rejects.toThrow(/терять подробности/)
    expect(write).not.toHaveBeenCalled()
  })
})
