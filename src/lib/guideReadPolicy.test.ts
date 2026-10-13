import { describe, expect, it } from 'vitest'
import { isSubjectExpanded, visibleGuideTaskIds } from './guideReadPolicy'

/** @see ../../docs/product/day-page.md#completed-subjects */
describe('existing subject disclosure', () => {
  it('opens unfinished work and folds completed work by default', () => {
    expect(isSubjectExpanded('biology', false, {})).toBe(true)
    expect(isSubjectExpanded('geography', true, {})).toBe(false)
  })

  it('keeps an explicit parent choice in either direction', () => {
    expect(isSubjectExpanded('geography', true, { geography: true })).toBe(true)
    expect(isSubjectExpanded('biology', false, { biology: false })).toBe(false)
  })

  it('opens the destination subject even when its saved status is complete', () => {
    expect(isSubjectExpanded('geography', true, {}, true)).toBe(true)
    expect(isSubjectExpanded('geography', true, { geography: false }, true)).toBe(false)
  })
})

describe('parent guide read budget', () => {
  const subjects = [
    { id: 'geography', tasks: [{ id: 'geo' }] },
    { id: 'biology', tasks: [{ id: 'bio' }] },
    { id: 'english', tasks: [{ id: 'eng' }] },
    { id: 'math', tasks: [{ id: 'sheet', problems: [{ id: 'problem-1' }] }] },
  ]
  const done = (subject: { id: string }) => subject.id !== 'math'

  it('keeps completed subjects out of the initial private guide query', () => {
    expect(visibleGuideTaskIds(subjects, {}, done)).toEqual(['sheet', 'problem-1'])
    // Five potential document rows become two on the initial parent view.
    expect(visibleGuideTaskIds(subjects, {}, done)).toHaveLength(2)
  })

  it('fetches a completed subject after the parent expands it', () => {
    expect(visibleGuideTaskIds(subjects, { geography: true }, done)).toEqual(['geo', 'sheet', 'problem-1'])
  })

  it('opens no private guide query when every subject is folded', () => {
    expect(visibleGuideTaskIds(subjects, {}, () => true)).toEqual([])
  })
})
