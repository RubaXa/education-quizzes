import { describe, expect, it } from 'vitest'
import { taskUploadPresentation, uploadOriginTitle } from './taskUploadPresentation'
import type { DayPageData, DayUpload } from './dayStore'

/** @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo */
describe('upload location is separate from review coverage', () => {
  it.each([
    { status: 'pending' },
    { status: 'pending', processingTaskIds: ['p2', 'p3'] },
    { status: 'reviewed', coveredTaskIds: ['p2', 'p3'] },
    { status: 'reviewed', coveredTaskIds: ['p2'], processingTaskIds: ['p3'] },
  ] as Partial<DayUpload>[])('retains the origin through classification and review: %j', (fields) => {
    const photo = { id: 'day:photo', taskId: 'p1', ...fields } as DayUpload
    const snapshot = JSON.stringify(photo)
    expect(taskUploadPresentation([photo, photo], 'p1').owned).toEqual([photo])
    expect(taskUploadPresentation([photo], 'p2').owned).toEqual([])
    expect(taskUploadPresentation([photo], 'p1').linked).toEqual([])
    expect(taskUploadPresentation([photo], 'p2').linked).toEqual(fields.coveredTaskIds || fields.processingTaskIds ? [photo] : [])
    expect(JSON.stringify(photo)).toBe(snapshot)
    if (fields.coveredTaskIds) expect(taskUploadPresentation([photo], 'p1').evidence).toEqual([])
  })

  it('preserves legacy behavior and never associates an unrelated upload', () => {
    const photo = { id: 'photo', taskId: 'p1', status: 'pending' } as DayUpload
    expect(taskUploadPresentation([photo], 'p1').evidence).toEqual([photo])
    expect(taskUploadPresentation([photo], 'p9')).toEqual({ owned: [], linked: [], evidence: [] })
    expect(taskUploadPresentation([{ ...photo, coveredTaskIds: [] }], 'p1')).toEqual({ owned: [{ ...photo, coveredTaskIds: [] }], linked: [], evidence: [] })
  })

  it('uses authorized pages for an exact source label including variant; missing pages remain explicit', () => {
    const photo = { id: 'photo', taskId: 'p1', status: 'reviewed' } as DayUpload
    const page = { subjects: [{ tasks: [{ id: 'sheet', title: 'Лист', practiceVariants: [{ id: 'v2', title: 'Вариант 2' }], problems: [{ id: 'p1', variantId: 'v2', number: 1, title: 'Книги' }] }] }] } as DayPageData
    expect(uploadOriginTitle(photo, [undefined, page])).toBe('Вариант 2 · № 1. Книги')
    expect(uploadOriginTitle(photo, [])).toBe('другое задание')
  })
})
