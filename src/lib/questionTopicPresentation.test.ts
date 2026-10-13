import { describe, expect, it } from 'vitest'
import { sharedQuestionTopic } from './questionTopicPresentation'

/** @see ../../docs/product/quizzes.md#quiz-runner */
describe('question topic placement', () => {
  it('moves one repeated topic above the question list', () => {
    expect(sharedQuestionTopic([{ topic: 'Food & Drinks: написание' }, { topic: 'Food & Drinks: написание' }]))
      .toBe('Food & Drinks: написание')
  })

  it('leaves different or single-question topics beside their questions', () => {
    expect(sharedQuestionTopic([{ topic: 'Правописание' }, { topic: 'Грамматика' }])).toBeUndefined()
    expect(sharedQuestionTopic([{ topic: 'Правописание' }])).toBeUndefined()
    expect(sharedQuestionTopic([{ topic: 'Правописание' }, {}])).toBeUndefined()
  })
})
