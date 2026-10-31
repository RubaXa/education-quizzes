import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

/** Keep selected-stage verification within Firestore's expression budget and
 * reject any learner payload that differs from the exact parent-selected stage.
 * @see ../docs/modules/reviews/subject-aware-guidance.md#data-contract */
test('day guidance caches authorization and selected stage while enforcing exact projection parity', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const start = rules.indexOf('function validDayGuidanceCreate(')
  const end = rules.indexOf('\n    // A stage choice needs one read', start)
  const helper = rules.slice(start, end)

  expect(helper).toContain('let stage = guide.stages[data.stageIndex]')
  expect(helper).toContain('let guide = get(/databases/$(database)/documents/dayTaskGuides/')
  expect((helper.match(/= get\(/g) ?? [])).toHaveLength(6)
  expect((helper.match(/\blet\s+/g) ?? [])).toHaveLength(7)
  expect(helper).toContain("member.active == true")
  expect(helper).toContain("member.role == 'parent'")
  expect(helper).toContain('member.childIds.hasAny([owner.childId])')
  expect(helper).toContain('data.taskId in page.taskIds')
  expect(helper).toContain('data.actorPersonId == link.personId')
  expect(helper).toContain('data.guideRevision == guide.revision')
  expect(helper).toContain('data.stageId == stage.id')
  expect(helper).toContain("data.text == (data.level == 'hint' ? stage.hintPreview : stage.revealPreview)")
  expect(helper).toContain("? !data.keys().hasAny(['revealContent'])")
  expect(helper).toContain("data.revealContent.keys().hasOnly(['title', 'expected', 'rows', 'blocks', 'role', 'why', 'answer', 'verification', 'sourceLabel'])")
  expect(helper).toContain("data.revealContent.get('blocks', []) == stage.get('blocks', [])")
  for (const field of ['title', 'expected', 'rows', 'role', 'why', 'answer', 'verification', 'sourceLabel']) {
    expect(helper).toContain(`data.revealContent.${field} ==`)
  }
  expect(helper).toContain("legacyOrEducationEventReceipt('parent.guidance_sent'")
  expect(rules).toContain('allow create: if validDayGuidanceCreate(studentToken, eventId, request.resource.data)')
})
