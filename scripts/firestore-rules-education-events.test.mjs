import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { strict as assert } from 'node:assert'

/** Client queue writes are append-only, scoped, and tied to their source in the same commit.
 * @see ../docs/modules/synchronization/event-queue.md#доступ-и-приватность */
test('educationEvents denies reads and mutation after create', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const start = rules.indexOf('match /educationEvents/{eventId}')
  const end = rules.indexOf('\n    }', start)
  const block = rules.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(block, /allow get, list: if false/)
  assert.match(block, /allow create: if validEducationEventCreate\(eventId, request\.resource\.data\)/)
  assert.match(block, /allow update, delete: if false/)
})

test('education event envelope rejects scope, actor, event, and source spoofing', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const helperStart = rules.indexOf('function validEducationEventSource(')
  const helperEnd = rules.indexOf('\n    function dayUploadOwner(', helperStart)
  const helpers = rules.slice(helperStart, helperEnd)
  assert.ok(helperStart > 0 && helperEnd > helperStart)
  assert.match(helpers, /eventId\.matches\('\^\[a-f0-9\]\{64\}\$'\)/)
  assert.match(helpers, /data\.actor\.uid == request\.auth\.uid/)
  assert.match(helpers, /data\.source == 'firestore'/)
  assert.match(helpers, /'upload\.delete_requested'/)
  assert.match(helpers, /data\.eventType == 'quiz\.started'/)
  assert.match(helpers, /data\.operationId == 'quiz-start:' \+ ref\.quizToken/)
  assert.match(helpers, /data\.sourceRef\.keys\(\)\.hasOnly\(\['kind', 'documentPath', 'dayToken', 'recordId', 'quizToken', 'taskId'\]\)/)
  assert.match(helpers, /childMember\(data\.familyId, data\.childId\)/)
  assert.match(helpers, /existsAfter\(sourcePath\)/)
  assert.match(helpers, /getAfter\(sourcePath\)\.data\.status == 'submitted'/)
  assert.match(helpers, /getAfter\(sourcePath\)\.data\.actorPersonId == currentPersonId\(\)/)
  assert.match(helpers, /data\.state == 'pending' && data\.attempts == 0/)
  assert.doesNotMatch(helpers, /allow read|allow list/)
  const createStart = rules.indexOf('function validEducationEventCreate(')
  const createEnd = rules.indexOf('\n    function validEducationEventReceipt(', createStart)
  const create = rules.slice(createStart, createEnd)
  assert.ok(createStart > 0 && createEnd > createStart)
  assert.match(create, /data\.eventType in \['help\.requested', 'quiz\.started', 'quiz\.submitted'/)
})

test('versioned source writes require their event receipt while unmarked old clients remain temporarily compatible', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const helperStart = rules.indexOf('function validEducationEventReceipt(')
  const helperEnd = rules.indexOf('\n    function dayUploadOwner(', helperStart)
  const helper = rules.slice(helperStart, helperEnd)
  assert.match(helper, /eventProducerVersion == 1/)
  assert.match(helper, /\.data\.eventId == data\.eventReceiptId/)
  assert.match(helper, /\.data\.sourceRef\.documentPath == documentPath/)
  assert.match(helper, /\.data\.createdAt == request\.time/)
  assert.match(helper, /\.data\.availableAt == request\.time/)
  assert.match(helper, /\.data\.state == 'pending'/)
  assert.match(helper, /legacyOrEducationEventReceipt/)
  assert.match(helper, /!request\.resource\.data\.keys\(\)\.hasAny\(\['eventOperationId', 'eventReceiptId', 'eventProducerVersion'\]\)/)
  assert.match(helper, /affectedKeys\(\)\.hasAny\(\['eventOperationId', 'eventReceiptId', 'eventProducerVersion'\]\)/)
})

// firebase.json configures no Firestore emulator and @firebase/rules-unit-testing
// is not installed here. These static checks document the constraints; they do
// not claim emulator-level proof of Rules evaluation.
