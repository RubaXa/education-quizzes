/** @see ../../docs/modules/school-diary/README.md#diary-adapter */
import { expect, it, vi } from 'vitest'
import { collectMarkDetails, collectMarkFeed } from './mark-details.mjs'

it('keeps detailed mark attachments and isolates them from normalized grade summaries', async () => {
  const raw = { id: 7, date: '2026-11-13', value: '2', result_files: [{ file_url: 'https://school.mos.ru/storage/controlwork/1/2/abcd' }] }
  const adapter = { verifyAccess: vi.fn(async () => ({ accountRole: 'parent' })), getMarkDetails: vi.fn(async () => raw) }
  const save = vi.fn()
  await collectMarkDetails({ adapter, date: '2026-11-13', markId: '7', save })
  expect(adapter.verifyAccess).toHaveBeenCalledOnce()
  expect(adapter.getMarkDetails).toHaveBeenCalledWith('2026-11-13', '7')
  expect(save).toHaveBeenCalledWith('mark-details-2026-11-13-7.json', expect.objectContaining({ date: '2026-11-13', marks: raw, source: 'mesh-detailed-marks' }))
})
it('rejects another date or ID and never describes the recent feed as a dated journal', async () => {
  const save = vi.fn()
  const adapter = { verifyAccess: vi.fn(async () => ({})), getMarkDetails: vi.fn(async () => ({ id: 8, date: '2026-11-16' })), getMarkFeed: vi.fn(async () => [{ id: 8, date: '2026-11-16' }]) }
  await expect(collectMarkDetails({ adapter, date: '2026-11-13', markId: '7', save })).rejects.toThrow('identity_mismatch')
  expect(save).not.toHaveBeenCalled()
  expect(await collectMarkFeed({ adapter, save })).toMatchObject({ scope: 'recent-feed-not-date-filtered' })
})
it('rejects an impossible date and unconfirmed access before reading marks', async () => {
  const adapter = { verifyAccess: vi.fn(async () => { throw Error('scope') }), getMarkDetails: vi.fn() }
  await expect(collectMarkDetails({ adapter, date: '2026-02-30', save: vi.fn() })).rejects.toThrow('date')
  expect(adapter.verifyAccess).not.toHaveBeenCalled()
  await expect(collectMarkDetails({ adapter, date: '2026-11-13', markId: '7', save: vi.fn() })).rejects.toThrow('scope')
  expect(adapter.getMarkDetails).not.toHaveBeenCalled()
})
