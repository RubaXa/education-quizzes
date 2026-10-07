import { describe, expect, it } from 'vitest'
import { buildFollowUpPrompt } from './followup'

describe('follow-up prompt', () => {
  it('carries the exact result link and asks for varied diagnostic tasks', () => {
    const prompt = buildFollowUpPrompt({ title: 'Пропорции', subject: 'Математика', slug: 'proportsii', token: 'private-token' })
    expect(prompt).toContain('#/t/proportsii~private-token')
    expect(prompt).toContain('npm run quiz -- export private-token')
    expect(prompt).toContain('не заполняй весь тест одной ошибкой')
    expect(prompt).toContain('связанный с исходным testId')
  })
})
