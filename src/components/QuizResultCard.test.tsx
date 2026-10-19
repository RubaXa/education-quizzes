import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ResultCard from './QuizResultCard'
import { grade, type AnswerKey, type Assignment } from '@/lib/quiz'

const assignment: Assignment = { schemaVersion: 1, testId: 'source-check', title: 'Реки', subject: 'География',
  questions: [{ id: 'unit', kind: 'short', prompt: 'Назови единицу солёности.', points: 1 }],
  answers: { unit: '%' }, status: 'submitted', startedAt: null, updatedAt: null, submittedAt: null }
const guidance = { observation: 'В сохранённом ответе стоит знак процента. Если вводил другой знак, это расхождение требует проверки ввода.',
  question: 'Какую долю числа обозначает единица в определении солёности?',
  source: { title: 'Алексеев и др. География. 5–6 классы', edition: '2024, 13-е стереотипное', section: '§ 33. Почему вода в Океане солёная?',
    pages: 'Печатная с. 107, PDF с. 108', locator: 'Первый абзац и выделенная рамка «Солёность».' } }
const render = (key: AnswerKey) => renderToStaticMarkup(createElement(ResultCard, { result: grade(assignment, key)[0], index: 0 }))

describe('specific quiz feedback', () => {
  it('shows the checked observation, diagnostic question and exact source without the closed key', () => {
    const html = render({ entries: { unit: { correct: 'CLOSED-ANSWER', explanation: 'CLOSED-EXPLANATION', guidance } } })
    for (const text of [guidance.observation, guidance.question, guidance.source.title, guidance.source.pages, guidance.source.locator]) expect(html).toContain(text)
    expect(html).not.toContain('CLOSED-')
    expect(html).not.toContain('Вернись к материалу, указанному')
  })
  it('states the missing review honestly instead of inventing a cause for a legacy answer', () => {
    const html = render({ entries: { unit: { correct: 'CLOSED-ANSWER', explanation: 'CLOSED-EXPLANATION' } } })
    expect(html).toContain('Для этого вопроса ещё нет проверенного разбора с точным источником.')
    expect(html).not.toContain('На каком шаге твоя запись')
    expect(html).not.toContain('CLOSED-')
  })
  it('also exposes the provenance of a correct question', () => {
    expect(render({ entries: { unit: { correct: '%', guidance } } })).toContain(guidance.source.locator)
  })
  it('preserves formulas and literal source notation in the prompt', () => {
    const question = { ...assignment.questions[0], prompt: 'Сравни Н2О и А1:что означает запись?' }
    const result = grade({ ...assignment, questions: [question] }, { entries: { unit: { correct: '%', guidance } } })[0]
    expect(renderToStaticMarkup(createElement(ResultCard, { result, index: 0 }))).toContain(question.prompt)
  })
  it('shows the exact checked source alongside the spelling-specific review', () => {
    const question = { ...assignment.questions[0], topic: 'Словарный диктант', prompt: 'Напиши слово по подсказке.' }
    const result = grade({ ...assignment, questions: [question], answers: { unit: 'wrod' } }, { entries: { unit: { correct: 'word', guidance } } })[0]
    const html = renderToStaticMarkup(createElement(ResultCard, { result, index: 0 }))
    expect(html).toContain('Как пишется')
    expect(html).toContain(guidance.source.title)
    expect(html).toContain(guidance.source.locator)
  })
})
