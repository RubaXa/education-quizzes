import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { strict as assert } from 'node:assert'

/** Keep the reviewed-stage rule inside Firestore's document access budget.
 * @see ../docs/modules/school-diary/day-page.md#review-stage-switch */
test('reviewed-stage choice reads seven source documents once and keeps exact-version guards', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const helper = rules.slice(rules.indexOf('function validReviewedStageChoice('), rules.indexOf('\n    // A random invite code', rules.indexOf('function validReviewedStageChoice(')))
  assert.match(helper, /let guide = get\(/)
  assert.match(helper, /let review = get\(/)
  assert.equal((helper.match(/get\(/g) ?? []).length, 7)
  assert.match(helper, /member\.role == 'parent'/)
  assert.match(helper, /owner\.childId in member\.childIds/)
  assert.match(helper, /data\.actorPersonId == link\.personId/)
  assert.match(helper, /data\.taskId in page\.taskIds/)
  assert.match(helper, /data\.stageId == guide\.stages\[data\.stageIndex\]\.id/)
  assert.match(helper, /data\.stageId in review\.checkableStageIds/)
  assert.match(helper, /data\.reviewCheckedAt == review\.checkedAt/)
  assert.match(rules, /validReviewedStageChoice\(studentToken, eventId, request\.resource\.data\)/)
})
