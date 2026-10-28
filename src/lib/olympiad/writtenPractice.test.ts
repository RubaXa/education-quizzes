import { describe, expect, it } from 'vitest'
import { addPhoto, completeReview, latestResult, startReview, type WrittenPractice } from './writtenPractice'

const empty: WrittenPractice = { attempts: [] }
describe('written practice transitions', () => {
  it('groups photos until review and creates a new attempt after a result', () => {
    let s = addPhoto(empty, 'a1', 'p1')
    s = addPhoto(s, 'a1', 'p2')
    s = startReview(s, 'a1', 'r1')
    s = completeReview(s, 'a1', 'r1', 'partial')
    s = addPhoto(s, 'a2', 'p3')
    expect(s.attempts).toHaveLength(2)
    expect(s.attempts[0].reviews[0].photoIds).toEqual(['p1','p2'])
    expect(latestResult(s)).toBe('partial')
  })
  it('preserves photos submitted during review in the same attempt and evaluates them later', () => {
    let s = startReview(addPhoto(empty, 'a1', 'p1'), 'a1', 'r1')
    s = addPhoto(s, 'a1', 'p2')
    s = completeReview(s, 'a1', 'r1', 'needs-fix')
    s = addPhoto(s, 'a1', 'p3')
    expect(s.attempts[0].reviews[0].photoIds).toEqual(['p1'])
    s = startReview(s, 'a1', 'r2')
    expect(s.attempts[0].reviews[1].photoIds).toEqual(['p1','p2','p3'])
  })
  it('keeps unreadable work in the same attempt and retains previous substantive result', () => {
    let s = completeReview(startReview(addPhoto(empty,'a1','p1'),'a1','r1'),'a1','r1','partial')
    s = completeReview(startReview(addPhoto(s,'a2','p2'),'a2','r2'),'a2','r2','unreadable')
    s = addPhoto(s,'a2','p3')
    expect(s.attempts).toHaveLength(2)
    expect(latestResult(s)).toBe('partial')
  })
  it('deduplicates events and rejects conflicting completions', () => {
    let s = addPhoto(empty,'a1','p1')
    expect(addPhoto(s,'a1','p1')).toBe(s)
    expect(() => addPhoto(s,'other','p1')).toThrow()
    s = startReview(s,'a1','r1')
    expect(startReview(s,'a1','r1')).toBe(s)
    s = completeReview(s,'a1','r1','verified')
    expect(completeReview(s,'a1','r1','verified')).toBe(s)
    expect(() => completeReview(s,'a1','r1','partial')).toThrow()
  })
})
