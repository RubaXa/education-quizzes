import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { strict as assert } from 'node:assert'

/** Static guard for the narrow parent write; live rule compilation is checked at deployment.
 * @see ../docs/product/quizzes.md#followup-request */
test('parent follow-up write cannot alter answers or score', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const start = rules.indexOf('// A parent may request one linked practice cycle')
  const end = rules.indexOf('\n    }', start)
  const grant = rules.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(grant, /resource\.data\.status == 'submitted'/)
  assert.match(grant, /parentMember\(resource\.data\.familyId\)/)
  assert.match(grant, /childMember\(resource\.data\.familyId, resource\.data\.childId\)/)
  assert.match(grant, /!\('followupRequestedAt' in resource\.data\)/)
  assert.match(grant, /affectedKeys\(\)\.hasOnly\(\['followupRequestedAt', 'followupRequestedBy'\]\)/)
  assert.match(grant, /followupRequestedBy == currentPersonId\(\)/)
})
