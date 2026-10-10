import { describe, expect, it } from 'vitest'
import { reviewCoverage } from './review-coverage.mjs'

const a = 'a'.repeat(24)
const b = 'b'.repeat(24)
const batch = {
  uploadIds: [a, b],
  reviews: [
    { taskId: 'task-p01', uploadIds: [a] },
    { taskId: 'task-p02', uploadIds: [a, b] },
  ],
  photoCoverage: [
    { uploadId: a, taskIds: ['task-p01', 'task-p02'], observed: '№ 1 сверху, № 2 снизу' },
    { uploadId: b, taskIds: ['task-p02'], observed: 'Продолжение № 2' },
  ],
}

describe('shared photo coverage', () => {
  it('links one original to every actually reviewed task', () => {
    expect(reviewCoverage(batch).get(a).taskIds).toEqual(['task-p01', 'task-p02'])
  })
  it('rejects an unreviewed solution on a photo', () => {
    expect(() => reviewCoverage({
      ...batch,
      photoCoverage: [{ ...batch.photoCoverage[0], taskIds: ['task-p01'] }, batch.photoCoverage[1]],
    })).toThrow('не совпадают')
  })
  it('rejects a photo omitted from explicit classification', () => {
    expect(() => reviewCoverage({ ...batch, photoCoverage: [batch.photoCoverage[0]] })).toThrow('каждой фотографии')
  })
})
