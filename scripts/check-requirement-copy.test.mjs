import { describe, expect, it } from 'vitest'
import { visibleRequirementCopyProblems } from './check-requirement-copy.mjs'

describe('visible requirement copy gate', () => {
  it.each(['По желанию', 'по желанию', 'ОБЯЗАТЕЛЬНО', 'Опционально'])(
    'rejects a new visible control label %s', label => {
      for (const code of [`<summary>${label}</summary>`, `<span>{'${label}'}</span>`, `<button>{ready ? '${label}' : 'Проверено'}</button>`]) {
        expect(visibleRequirementCopyProblems('src/NewCard.tsx', code)).toHaveLength(1)
      }
    })
  it('allows source data, citations, accessible names and actual result labels', () => {
    const source = `const teacherText = 'По желанию'; const card = <div>
      <summary aria-label="Обязательно"><b>Проверено</b></summary>
      <blockquote>{teacherText}</blockquote>
      <span>Исправить</span><button title="По желанию">Открыть</button>
    </div>`
    expect(visibleRequirementCopyProblems('src/Card.tsx', source)).toEqual([])
  })
  it('rejects paragraph copy and a badge through a uniquely bound local variable', () => {
    expect(visibleRequirementCopyProblems('src/Card.tsx', `<p>Самопроверка доступна по желанию</p>`)).toHaveLength(1)
    expect(visibleRequirementCopyProblems('src/Card.tsx', `const badge = active ? 'Проверено' : 'По желанию'; const view = <span>{badge}</span>`)).toHaveLength(1)
  })
})
