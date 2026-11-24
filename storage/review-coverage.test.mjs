import { describe, expect, it } from 'vitest'
import { reviewCoverage, publishedPhotoCoverage } from './review-coverage.mjs'

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
  const upload = { taskId: 'placement', status: 'reviewed', coveredTaskIds: ['visible-one', 'visible-two'], coverageNote: 'Two visible solutions.' }
  const results = new Map([['visible-one', { status: 'needs-fix', uploadIds: [a] }], ['visible-two', { status: 'verified', uploadIds: [a] }]])
  it('completes photo review without claiming the unrelated upload placement was solved', () => {
    expect(publishedPhotoCoverage(a, upload, results)).toBe(true)
    expect(results.has('placement')).toBe(false)
  })
  it('requires an addressed result for every covered task, not just reviewed metadata', () => {
    expect(publishedPhotoCoverage(a, upload, new Map([...results].slice(0, 1)))).toBe(false)
    expect(publishedPhotoCoverage(b, upload, results)).toBe(false)
    expect(publishedPhotoCoverage(a, {...upload, status: 'pending'}, results)).toBe(false)
  })
  it('preserves a completed photo when a later attempt replaces the current result', () => {
    const later = new Map(results)
    later.set('visible-two', { status: 'partial', uploadIds: [b], history: [results.get('visible-two')] })
    expect(publishedPhotoCoverage(a, upload, later)).toBe(true)
  })
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
