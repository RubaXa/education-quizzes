// @see ../docs/product/ui-change-control.md#mechanical-gate
import { describe, expect, it } from 'vitest'
import { checkUiContracts, isProductUiFile, sha256 } from './check-ui-contract.mjs'

const original = 'old CSS'
const changed = 'new CSS'
const path = 'src/components/ProblemCard.css'
const record = 'docs/product/ui-decisions/2026-10-14-card-layout.md'
const spec = 'docs/product/problem-card-design-decisions.md'
const test = 'src/components/ProblemCard.test.tsx'
const authorization = { status: 'direct-request', evidence: 'Запрос пользователя в текущем разговоре: исправить оформление номера.' }
const recordText = `# Решение\n\n${path}\n\n## Основание\nЗапрос пользователя.\n\n## Было → стало\nИзменена компоновка.\n\n## Действия и роли\nОбе роли.\n\n## Проверки\nСнимок и тест.\n\n## Согласование\nЯвное решение.`

function fixture({ content = original, decision, paths = [path], available = [record, spec, test], text = recordText } = {}) {
  return checkUiContracts({
    paths,
    baseline: { files: { [path]: sha256(original) } },
    decisions: { files: decision ? { [path]: decision } : {} },
    read: (name) => name === path ? content : name === record ? text : '',
    exists: (name) => available.includes(name),
  })
}

describe('UI decision gate', () => {
  it('covers interface, status projection and publication modules but not tests', () => {
    expect(['src/App.tsx', 'src/DayPage.css', 'src/lib/reviewPresentation.ts', 'day/card-policy.mjs', 'storage/review-projection.mjs', 'scripts/day.mjs', 'operator/run-operation.mjs'].every(isProductUiFile)).toBe(true)
    expect(isProductUiFile('src/components/ProblemCard.test.tsx')).toBe(false)
    expect(isProductUiFile('scripts/check-ui-contract.mjs')).toBe(false)
  })
  it('accepts the sealed current layout without a new decision', () => {
    expect(fixture()).toEqual([])
  })

  it('stops an unreviewed CSS move', () => {
    expect(fixture({ content: changed })).toContainEqual(expect.stringContaining('Продуктовый код изменён без решения'))
  })

  it('stops a stale approval or a missing regression test', () => {
    const decision = { sha256: sha256(original), record, specs: [spec], tests: [test], authorization }
    expect(fixture({ content: changed, decision })).toContainEqual(expect.stringContaining('Устарел отпечаток'))
    expect(fixture({ content: changed, decision: { ...decision, sha256: sha256(changed) }, available: [record, spec] }))
      .toContainEqual(expect.stringContaining('нужны существующие регрессионные тесты'))
  })

  it('accepts a traced change with a current spec and regression test', () => {
    const decision = { sha256: sha256(changed), record, specs: [spec], tests: [test], authorization }
    expect(fixture({ content: changed, decision })).toEqual([])
  })

  it('does not accept an unapproved mockup as a product decision', () => {
    const decision = { sha256: sha256(changed), record, specs: [spec], tests: [test],
      authorization: { status: 'pending', evidence: 'Макет показан пользователю, ответа пока нет.' } }
    expect(fixture({ content: changed, decision })).toContainEqual(expect.stringContaining('прямой запрос пользователя'))
  })

  it('requires an explicit decision for a new UI file', () => {
    const newPath = 'src/components/NewCard.tsx'
    expect(fixture({ paths: [path, newPath] })).toContainEqual(expect.stringContaining(`Продуктовый код изменён без решения: ${newPath}`))
  })
})
