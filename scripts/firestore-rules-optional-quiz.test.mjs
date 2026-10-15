import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { strict as assert } from 'node:assert'

/** Narrow parent write for the family requirement; answers and score are immutable.
 * @see ../docs/product/quizzes.md#optional-quiz */
test('only a parent can toggle the root self-check requirement', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const start = rules.indexOf('// Only a parent may change whether a root self-check counts')
  const end = rules.indexOf('\n    }', start)
  const grant = rules.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(grant, /parentMember\(resource\.data\.familyId\)/)
  assert.match(grant, /childMember\(resource\.data\.familyId, resource\.data\.childId\)/)
  assert.match(grant, /linkedToTestId/)
  assert.match(grant, /affectedKeys\(\)\.hasOnly\(\['familyOptional', 'familyChoiceAt', 'familyChoiceBy'\]\)/)
  assert.match(grant, /affectedKeys\(\)\.hasAll\(\['familyOptional', 'familyChoiceAt'\]\)/)
  assert.match(grant, /request\.resource\.data\.familyOptional is bool/)
  assert.match(grant, /request\.resource\.data\.familyChoiceBy == currentPersonId\(\)/)
  assert.doesNotMatch(grant, /'answers'|'points'|'status'/)
})
