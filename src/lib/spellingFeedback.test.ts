import { describe, expect, it } from 'vitest'
import { spellingFeedback } from './spellingFeedback'
import { grade } from './quiz'
import type { Assignment, QuestionResult } from './quiz'

const result = (answer: string | undefined, correctAnswer: string): QuestionResult => ({
  question: { id: 'word', kind: 'short', topic: 'Food & Drinks: написание', prompt: 'Напиши по-английски слово.', points: 1 },
  answer,
  correctAnswer,
  points: 0,
  source: 'Starlight 6, с. 25',
})

describe('spellingFeedback', () => {
  it('names the exact wrong final letter in cod', () => {
    expect(spellingFeedback(result('Cob', 'cod'))?.detail).toContain('«b» вместо «d»')
  })

  it('names the extra letter in orange', () => {
    expect(spellingFeedback(result('Oreange', 'orange'))?.detail).toContain('лишняя «e»')
  })

  it('shows the exact word for an omitted dictation answer', () => {
    const assignment: Assignment = {
      schemaVersion: 1, testId: 'dictation', title: 'Диктант', subject: 'Английский язык',
      questions: [{ id: 'rice', kind: 'short', topic: 'Food & Drinks: написание', prompt: 'Напиши слово.', points: 1 }],
      answers: {}, status: 'submitted', startedAt: null, updatedAt: null, submittedAt: null,
    }
    const [graded] = grade(assignment, { entries: { rice: { correct: 'rice' } } })
    expect(spellingFeedback(graded)).toMatchObject({ correct: 'rice', detail: 'Слово пропущено.' })
  })

  it('does not reveal a key for an unrelated short answer', () => {
    const unrelated = result('5', '6')
    unrelated.question.topic = 'Математика'
    expect(spellingFeedback(unrelated)).toBeNull()
  })
})
