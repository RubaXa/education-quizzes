import { expect, it } from 'vitest'
import { diffSnapshots } from './diff.mjs'
it('detects a homework point when the numeric average and count stay unchanged', () => {
  const prior = { marks: [{ subject_id: 7, average: 4.6, count: 13, marks: [] }] }
  expect(diffSnapshots(prior, { ...prior, marks: [{ ...prior.marks[0], recentMarks: [{ id: 123, value: 2, is_point: true }] }] }).sections.marks.changed).toEqual(['7:'])
})
