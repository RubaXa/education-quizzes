import { describe, expect, it } from 'vitest'
import { repeatedQuestionCopy } from './question-copy.mjs'

/** @see ../docs/product/quizzes.md#question-copy */
describe('question heading copy', () => {
  it('catches repeated task labels and instructions across a dictation', () => {
    const prompts = ['хлеб', 'рис', 'сыр'].map((word) => ({
      prompt: `Словарный диктант: как по-английски пишется «${word}»? Запиши по памяти форму из учебника, без артикля.`,
    }))
    expect(repeatedQuestionCopy(prompts)).toHaveLength(2)
  })

  it('keeps short and genuinely distinct questions', () => {
    expect(repeatedQuestionCopy(['Хлеб', 'Рис', 'Сыр'].map((prompt) => ({ prompt })))).toEqual([])
    expect(repeatedQuestionCopy([{ prompt: 'Прочитай условие и реши №1' }, { prompt: 'Прочитай условие и реши №2' }])).toEqual([])
  })
})
