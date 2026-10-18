// @see ../docs/modules/families/access-and-state.md#access-diagnostics
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
test('diagnostic writes require this device, real participant and an operator window; client reads remain forbidden', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const block = rules.slice(rules.indexOf('match /clientRoleDiagnostics/'), rules.indexOf('match /accessLinks/'))
  expect(block).toContain('request.auth.uid == authUid')
  expect(block).toContain('allow read, delete: if false')
  expect(block).toContain('request.resource.data.personId == currentPersonId()')
  expect(block).toContain('childMember(request.resource.data.familyId, request.resource.data.childId)')
  expect(block).toContain('request.time < request.resource.data.expiresAt')
  expect(block).toContain('data.accessDiagnosticsUntil')
  expect(block).toContain('request.resource.data.sampledAt == request.time')
  expect(block).not.toMatch(/answers|linkToken|publicUrl|upload/)
})
