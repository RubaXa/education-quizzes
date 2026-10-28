import { describe, expect, it } from 'vitest'
import { applyLessonCommand, startAttempt, studentLessonView, validateLesson } from './lesson.mjs'
import { getTrainingLesson, listTrainingLessons } from './training-content.mjs'

describe('authored training content', () => {
  it('has unique, versioned server definitions and no keys in the catalog', () => {
    const catalog = listTrainingLessons()
    expect(catalog).toHaveLength(3)
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(3)
    expect(JSON.stringify(catalog)).not.toMatch(/correctOptionIds|correctExplanation|incorrectHint|steps/)
    for (const entry of catalog) {
      expect(entry.origin).toBe('author-training')
      expect(entry.available).toBe(false)
      expect(entry.theory.length).toBeGreaterThan(20)
      expect(entry.sources.every((source) => source.url.startsWith('https://'))).toBe(true)
      expect(validateLesson(getTrainingLesson(entry.id))).toBeTruthy()
    }
    expect(getTrainingLesson('missing')).toBeNull()
  })

  it('runs each lesson to completion and does not expose the key before an answer', () => {
    for (const entry of listTrainingLessons()) {
      const lesson = getTrainingLesson(entry.id)
      let attempt = startAttempt(lesson, { attemptId: 'a', familyId: 'f', childId: 'c', olympiadId: 'o' })
      for (const [index, step] of lesson.steps.entries()) {
        const view = studentLessonView(lesson, attempt)
        expect(view.step.id).toBe(step.id)
        expect(JSON.stringify(view)).not.toContain('correctOptionIds')
        const incorrect = step.options.find((option) => !step.correctOptionIds.includes(option.id))
        expect(incorrect).toBeTruthy()
        attempt = applyLessonCommand(lesson, attempt, { id: `wrong-${index}`, type: 'answer', optionId: incorrect.id, at: '2026-10-27T12:00:00Z' })
        expect(attempt.feedback.correct).toBe(false)
        attempt = applyLessonCommand(lesson, attempt, { id: `right-${index}`, type: 'answer', optionId: step.correctOptionIds[0], at: '2026-10-27T12:00:00Z' })
        expect(attempt.feedback.correct).toBe(true)
        attempt = applyLessonCommand(lesson, attempt, { id: `next-${index}`, type: 'advance', at: '2026-10-27T12:00:00Z' })
      }
      expect(attempt.status).toBe('completed')
      expect(studentLessonView(lesson, attempt).hintCount).toBe(lesson.steps.length)
    }
  })

  it('does not allow callers to mutate subsequent catalog or definitions', () => {
    const metadata = listTrainingLessons()
    metadata[0].sources[0].title = 'changed'
    const lesson = getTrainingLesson(metadata[0].id)
    lesson.steps[0].correctOptionIds[0] = 'changed'
    expect(listTrainingLessons()[0].sources[0].title).not.toBe('changed')
    expect(getTrainingLesson(metadata[0].id).steps[0].correctOptionIds).not.toContain('changed')
  })
})
