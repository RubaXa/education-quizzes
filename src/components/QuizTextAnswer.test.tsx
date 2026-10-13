import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuizTextAnswer } from './QuizTextAnswer'
import type { QuizVisual } from '@/lib/quiz'

const noop = () => {}

function markup(kind: 'short' | 'number' | 'long', subject: string, visual?: QuizVisual) {
  return renderToStaticMarkup(createElement(QuizTextAnswer, {
    kind,
    subject,
    visual,
    value: kind === 'number' ? '12' : 'student answer',
    disabled: false,
    onAnswer: noop,
  }))
}

describe('quiz text answers', () => {
  it('keeps the existing short and numeric answer fields', () => {
    expect(markup('short', 'Математика')).toContain('inputMode="text"')
    expect(markup('short', 'Математика')).toContain('value="student answer"')
    expect(markup('number', 'Математика')).toContain('inputMode="decimal"')
    expect(markup('number', 'Математика')).toContain('value="12"')
  })

  it('keeps the existing long answer field', () => {
    expect(markup('long', 'Литература')).toContain('<textarea')
    expect(markup('long', 'Литература')).toContain('student answer</textarea>')
  })

  it('disables writing assistance for every English text answer', () => {
    for (const kind of ['short', 'long'] as const) {
      const html = markup(kind, 'Английский язык')
      expect(html).toContain('autoComplete="off"')
      expect(html).toContain('autoCorrect="off"')
      expect(html).toContain('autoCapitalize="off"')
      expect(html).toContain('spellCheck="false"')
    }
    expect(markup('short', 'Иностранный (английский) язык')).toContain('spellCheck="false"')
    expect(markup('long', 'Язык', { preset: 'english' })).toContain('spellCheck="false"')
    expect(markup('short', 'English', { preset: 'general' })).toContain('spellCheck="false"')
    expect(markup('short', 'Математика')).not.toContain('spellCheck="false"')
  })
})
