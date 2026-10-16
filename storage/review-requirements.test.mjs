import { describe, expect, it } from 'vitest'
import { requirementSummary, validateRequirementChecks } from './review-requirements.mjs'

const meshExcerpt = 'Упр. 218, 223 (выписать только средства выразительности).'
const materialExcerpt = '218. Найдите в предложениях сравнения.'
const uploadId = '6bbe2439-7b37-458b-84a1-8dbd09a0da89'
const base = { uploadIds: [uploadId], checkableStageIds: ['mesh-218'],
  items: [{ stageId: 'mesh-218', status: 'correct' }],
  assessmentBasis: { sources: [{ kind: 'mesh', role: 'requirement', excerpt: meshExcerpt }, { kind: 'textbook', role: 'context', excerpt: materialExcerpt }] },
  requirementChecks: [{ id: 'mesh-218', action: 'Выписать сравнения из номера 218', meshExcerpt, materialExcerpt,
    evidence: { state: 'visible', uploadId, observation: 'На фото виден отдельный список сравнений.' },
    result: 'confirmed', explanation: 'Сравнения выписаны; полные предложения не требовались.' }] }

describe('трасса обязательных требований', () => {
  it('принимает точную связь МЭШ → учебник → фото → результат', () => {
    expect(() => validateRequirementChecks(base)).not.toThrow()
    expect(requirementSummary(base.requirementChecks)).toEqual({ confirmed: 1, total: 1 })
  })
  it('не даёт назвать невидимый номер ошибкой или подтвердить его без фото', () => {
    const check = base.requirementChecks[0]
    expect(() => validateRequirementChecks({ ...base, requirementChecks: [{ ...check, evidence: { ...check.evidence, state: 'outside-frame' } }] })).toThrow()
    expect(() => validateRequirementChecks({ ...base, items: [{ stageId: 'mesh-218', status: 'cannot-assess' }] })).toThrow()
  })
  it('не принимает учебник в роли МЭШ и лишний обязательный номер', () => {
    expect(() => validateRequirementChecks({ ...base, assessmentBasis: { sources: [{ kind: 'textbook', role: 'context', excerpt: materialExcerpt }] } })).toThrow()
    expect(() => validateRequirementChecks({ ...base, checkableStageIds: ['mesh-218', 'mesh-223'] })).toThrow()
  })
})
