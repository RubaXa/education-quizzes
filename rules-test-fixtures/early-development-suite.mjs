/** @see ../docs/modules/families/early-development.md */
const prefix = '/databases/(default)/documents/'
const family = 'fixture-early-family', child = 'fixture-early-child', person = 'fixture-early-parent', uid = 'fixture-early-device'
const base = `families/${family}/children/${child}`
const path = `${base}/earlyObservations/fixture-observation`
const revisionId = '11111111-1111-4111-8111-111111111111'
const time = '2026-10-22T18:00:00Z'
const value = { schemaVersion: 1, activityId: 'voice', activityTitle: 'Знакомый голос', programVersion: 'fixture-program', observedAt: '2026-10-22T18:00:00.000Z', reaction: 'Другое', note: 'Synthetic fixture', deleted: false, authorId: person, createdAt: time, updatedAt: time, updatedBy: person, revision: 1, revisionId }
const documents = () => ({
  [`deviceSessions/${uid}`]: { linkToken: 'L'.repeat(43) },
  [`accessLinks/${'L'.repeat(43)}`]: { active: true, personId: person },
  [`families/${family}/members/${person}`]: { active: true, role: 'parent', childIds: [], earlyChildIds: [child] },
  [base]: { active: true, learningMode: 'early-development' },
  [`${base}/earlyDevelopment/current`]: { programVersion: 'fixture-program' },
  [`${path}/history/${revisionId}`]: value,
  [path]: value,
})
function fixture(name, { method = 'create', target = path, next = value, prior = null, mutate = () => {}, expectation = 'ALLOW' } = {}) {
  const docs = structuredClone(documents()); mutate(docs)
  return { name, expectation, expressionReportLevel: expectation === 'ALLOW' ? 'FULL' : 'NONE', resource: prior ? { data: prior } : null,
    request: { auth: { uid }, path: prefix + target, method, time, resource: { data: next } },
    functionMocks: Object.entries(docs).flatMap(([p, data]) => ['get', 'getAfter', 'exists', 'existsAfter'].map((fn) => ({ function: fn, args: [{ exactValue: prefix + p }], result: { value: fn.startsWith('exists') ? true : { data } } }))),
  }
}
export function earlyDevelopmentRulesSuite() {
  const member = `families/${family}/members/${person}`
  const revised = { ...value, revision: 2, revisionId: '22222222-2222-4222-8222-222222222222', deleted: true }
  const update = (name, overrides = {}) => fixture(name, { method: 'update', prior: value, next: revised,
    mutate: (docs) => { docs[`${path}/history/${revised.revisionId}`] = revised }, ...overrides })
  return [
    fixture('parent-create-with-history'),
    fixture('parent-read-plan', { method: 'get', target: `${base}/earlyDevelopment/current` }),
    fixture('parent-list-journal', { method: 'list', target: path }),
    fixture('student-cannot-read', { method: 'get', mutate: (docs) => { docs[member].role = 'student' }, expectation: 'DENY' }),
    fixture('parent-without-child-cannot-read', { method: 'get', mutate: (docs) => { docs[member].earlyChildIds = [] }, expectation: 'DENY' }),
    fixture('school-scope-does-not-grant-early-access', { method: 'get', mutate: (docs) => { docs[member].earlyChildIds = []; docs[member].childIds = [child] }, expectation: 'DENY' }),
    fixture('revoked-link', { method: 'get', mutate: (docs) => { docs[`accessLinks/${'L'.repeat(43)}`].active = false }, expectation: 'DENY' }),
    fixture('inactive-child', { method: 'get', mutate: (docs) => { docs[base].active = false }, expectation: 'DENY' }),
    fixture('school-mode-cannot-read', { method: 'get', mutate: (docs) => { docs[base].learningMode = 'school' }, expectation: 'DENY' }),
    fixture('forged-author', { next: { ...value, authorId: 'someone-else' }, expectation: 'DENY' }),
    fixture('wrong-program', { next: { ...value, programVersion: 'unknown' }, expectation: 'DENY' }),
    fixture('history-must-match', { mutate: (docs) => { docs[`${path}/history/${revisionId}`] = { ...value, note: 'Different' } }, expectation: 'DENY' }),
    update('soft-delete-with-history'),
    update('stale-revision', { next: { ...revised, revision: 1 }, expectation: 'DENY' }),
    update('immutable-provenance', { next: { ...revised, observedAt: '2026-10-20T18:00:00.000Z' }, expectation: 'DENY' }),
    fixture('hard-delete-denied', { method: 'delete', prior: value, expectation: 'DENY' }),
    fixture('history-create-matches-current', { target: `${path}/history/${revisionId}` }),
    fixture('history-cannot-rewrite', { target: `${path}/history/${revisionId}`, method: 'update', prior: value, expectation: 'DENY' }),
    fixture('history-cannot-delete', { target: `${path}/history/${revisionId}`, method: 'delete', prior: value, expectation: 'DENY' }),
    fixture('client-cannot-change-plan', { target: `${base}/earlyDevelopment/current`, next: { programVersion: 'fake' }, expectation: 'DENY' }),
  ]
}
