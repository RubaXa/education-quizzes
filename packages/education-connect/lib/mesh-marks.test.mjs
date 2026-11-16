import { afterEach, describe, expect, it, vi } from 'vitest'
import { MeshDiaryAdapter, normalizeSubjectPeriods } from './mesh.mjs'
afterEach(() => vi.unstubAllGlobals())

it('addresses the exact mark instead of trusting ignored date filters or has_files', async () => {
  const adapter = new MeshDiaryAdapter({ token: 'synthetic', studentId: 'student', profileId: 'profile' }, () => {})
  adapter.api.apiFetch = vi.fn(async () => ({ id: 7, has_files: false, result_files: [{ id: 9 }] }))
  expect(await adapter.getMarkDetails('2026-11-13', '7')).toMatchObject({ result_files: [{ id: 9 }] })
  const url = new URL(adapter.api.apiFetch.mock.calls[0][0])
  expect(url.pathname).toBe('/api/family/mobile/v1/marks/7')
  expect(url.searchParams.get('student_id')).toBe('student')
  await expect(adapter.getMarkDetails('2026-11-13', null)).rejects.toThrow('invalid_mark_id')
  await adapter.getMarkFeed()
  const feedUrl = new URL(adapter.api.apiFetch.mock.calls[1][0])
  expect(feedUrl.pathname).toBe('/api/family/mobile/v1/marks')
  expect([...feedUrl.searchParams.keys()].sort()).toEqual(['profile_id', 'student_id'])
})

it('downloads binary mark photos with a compatible Accept header and never sends credentials to another origin', async () => {
  const adapter = new MeshDiaryAdapter({ token: 'synthetic', studentId: 'student', profileId: 'profile' }, () => {})
  const fetch = vi.fn(async () => new Response(new Uint8Array([255, 216, 255, 217])))
  vi.stubGlobal('fetch', fetch)
  await expect(adapter.getMarkFile('https://example.org/storage/controlwork/1/2/abcd')).rejects.toThrow('unsafe_mark_file_url')
  expect(fetch).not.toHaveBeenCalled()
  expect((await adapter.getMarkFile('https://school.mos.ru/storage/controlwork/1/2/abcd')).length).toBe(4)
  expect(fetch.mock.calls[0][1].headers.Accept).toBe('*/*')
  fetch.mockImplementationOnce(async () => new Response('<html>Login</html>'))
  await expect(adapter.getMarkFile('https://school.mos.ru/storage/controlwork/1/2/abcd')).rejects.toThrow('invalid_binary')
})

describe('полный журнал отметок МЭШ', () => {
  it('берёт только текущий период и все отметки, включая вид работы и комментарий', () => {
    const result = normalizeSubjectPeriods([{ subject_name: 'Математика', subject_id: 7, periods: [
      { title: 'I четверть', start_iso: '2026-09-01', end_iso: '2026-11-22', value: '4.50', count: 2,
        marks: [{ id: 1, value: '5', weight: 1, date: '2026-10-13', control_form_name: 'Практическая работа', comment: 'Хорошо' },
          { id: 2, value: '4', weight: 1, date: '2026-10-14', control_form_name: 'Домашнее задание', comment: '' }] },
      { title: 'II четверть', start_iso: '2026-11-23', end_iso: '2027-01-10', value: null, count: 0, marks: [] },
    ] }], '2026-10-14')
    expect(result).toEqual([{ subject_name: 'Математика', subject_id: 7, period: 'I четверть',
      start: '2026-09-01', end: '2026-11-22', average: '4.50', count: 2,
      marks: expect.arrayContaining([expect.objectContaining({ id: 1, control_form_name: 'Практическая работа', comment: 'Хорошо' })]) }])
  })
  it('отклоняет неполный список отметок вместо неверной привязки к одинаковым пятёркам', () => {
    expect(() => normalizeSubjectPeriods([{ subject_name: 'Русский язык', periods: [
      { title: 'I четверть', start_iso: '2026-09-01', end_iso: '2026-11-22', value: '5', count: 2, marks: [{ value: '5' }] },
    ] }], '2026-10-14')).toThrow(/неполный/)
  })
})

it('shares the recent feed within one adapter run, retries failures and refreshes a new run', async () => {
  const create = () => new MeshDiaryAdapter({ token: 'synthetic', studentId: 'student', profileId: 'profile' }, () => {})
  const first = create()
  first.api.apiFetch = vi.fn(async () => [])
  await Promise.all([first.getMarkFeed(), first.getMarkFeed()])
  expect(first.api.apiFetch).toHaveBeenCalledTimes(1)
  const second = create()
  second.api.apiFetch = vi.fn().mockRejectedValueOnce(new Error('API 500')).mockResolvedValue([])
  await expect(second.getMarkFeed()).rejects.toThrow('API 500')
  await second.getMarkFeed()
  expect(second.api.apiFetch).toHaveBeenCalledTimes(2)
})
