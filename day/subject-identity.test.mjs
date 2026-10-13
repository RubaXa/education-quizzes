import { describe, expect, it } from 'vitest'
import { lessonSubjectKey, subjectPresentation } from './subject-identity.mjs'

describe('единая идентичность урока', () => {
  it('не смешивает спецкурс, практикум и обычную математику', () => {
    expect(lessonSubjectKey('Спецкурс по математике')).toBe('special')
    expect(lessonSubjectKey('Практикум по решению математических задач')).toBe('practicum')
    expect(lessonSubjectKey('Математика')).toBe('math')
  })

  it('сохраняет source ID для неизвестного предмета', () => {
    expect(subjectPresentation('Новый курс', 42)).toEqual(['subject-42', 'Новый курс', '📘'])
  })
})
