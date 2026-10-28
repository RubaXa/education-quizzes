import { describe, expect, it } from 'vitest'
import { applyLessonCommand, startAttempt, studentLessonView, validateLesson } from './lesson.mjs'

const lesson = { id: 'l1', version: 'v1', topicId: 't1', title: 'Пример', steps: [
  { id: 's1', prompt: 'Вопрос', options: [{ id: 'a', text: 'А' }, { id: 'b', text: 'Б' }], correctOptionIds: ['b'], correctExplanation: 'Верно', incorrectHint: 'Посмотри условие' },
  { id: 's2', prompt: 'Другой вопрос', options: [{ id: 'c', text: 'В' }, { id: 'd', text: 'Г' }], correctOptionIds: ['d'], correctExplanation: 'Верно', incorrectHint: 'Проверь' },
] }
const identity = { attemptId: 'a1', familyId: 'f1', childId: 'c1', olympiadId: 'o1' }
const command = (id, type, optionId) => ({ id, type, ...(optionId ? { optionId } : {}), at: '2026-10-27T12:00:00Z' })

describe('olympiad lesson aggregate', () => {
  it('records wrong answer and retry without leaking key or future steps', () => {
    const started = startAttempt(lesson, identity)
    const wrong = applyLessonCommand(lesson, started, command('1', 'answer', 'a'))
    const view = studentLessonView(lesson, wrong)
    expect(view.feedback).toEqual({ correct: false, text: 'Посмотри условие' })
    expect(view.hintCount).toBe(1)
    expect(JSON.stringify(view)).not.toContain('correctOptionId')
    expect(JSON.stringify(view)).not.toContain('Другой вопрос')
    expect(() => applyLessonCommand(lesson, wrong, command('2', 'advance'))).toThrow()
    const correct = applyLessonCommand(lesson, wrong, command('3', 'answer', 'b'))
    const next = applyLessonCommand(lesson, correct, command('4', 'advance'))
    const finished = applyLessonCommand(lesson, applyLessonCommand(lesson, next, command('5', 'answer', 'd')), command('6', 'advance'))
    expect(finished.status).toBe('completed')
    expect(finished.events).toHaveLength(5)
    expect(studentLessonView(lesson, finished).hintCount).toBe(1)
  })
  it('is idempotent for retries and rejects reused command ids', () => {
    const attempt = startAttempt(lesson, identity)
    const first = applyLessonCommand(lesson, attempt, command('1', 'answer', 'a'))
    expect(applyLessonCommand(lesson, first, command('1', 'answer', 'a'))).toBe(first)
    expect(() => applyLessonCommand(lesson, first, command('1', 'answer', 'b'))).toThrow('conflict')
  })
  it('accepts every reviewed correct alternative', () => {
    const alternativeLesson = { ...lesson, steps: [{ ...lesson.steps[0], correctOptionIds: ['a', 'b'] }] }
    const attempt = startAttempt(alternativeLesson, identity)
    expect(applyLessonCommand(alternativeLesson, attempt, command('1', 'answer', 'a')).feedback.correct).toBe(true)
    expect(applyLessonCommand(alternativeLesson, attempt, command('2', 'answer', 'b')).feedback.correct).toBe(true)
  })
  it('rejects malformed questions, answers and version mismatches', () => {
    expect(() => validateLesson({ ...lesson, steps: [{ ...lesson.steps[0], correctOptionIds: ['missing'] }] })).toThrow()
    const attempt = startAttempt(lesson, identity)
    expect(() => applyLessonCommand(lesson, attempt, command('1', 'answer', 'other'))).toThrow()
    expect(() => studentLessonView({ ...lesson, version: 'v2' }, attempt)).toThrow()
  })
})
