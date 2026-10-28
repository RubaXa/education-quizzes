/* @see ../docs/modules/assessments/olympiad-preparation.md */
import { createLessonService } from './lesson-service.mjs'
import { studentLessonView } from './lesson.mjs'

// The caller must supply a Firebase ID token verified by a trusted server.
// Never populate uid from the request body or accept a role from a client.
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const token = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
const scopeOK = (s) => s && ['familyId', 'childId', 'olympiadId', 'attemptId'].every((k) => id(s[k]))
const lessonOK = (lesson, lessonId, version) => lesson && lesson.id === lessonId && lesson.version === version
const unavailable = () => { throw new Error('Lesson unavailable') }
function safeSource(x) {
  if (typeof x?.title !== 'string' || !x.title.trim() || typeof x.url !== 'string') return false
  try { const url = new URL(x.url); return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password } catch { return false }
}
const validGrade = (n) => Number.isInteger(n) && n >= 1 && n <= 11
function eligibility(child, catalog) {
  const grade = child?.olympiadEligibility
  if (grade?.verified !== true || !validGrade(grade.grade)) return 'unknown'
  return catalog.gradeLevels.includes(grade.grade) ? 'eligible' : 'ineligible'
}
function checkedCatalog(catalog) {
  if (!catalog || catalog.status !== 'published' || catalog.practiceOnly !== true || typeof catalog.title !== 'string' || !catalog.title.trim()
    || !Array.isArray(catalog.gradeLevels) || !catalog.gradeLevels.length || !catalog.gradeLevels.every(validGrade)
    || !Array.isArray(catalog.lessonRefs) || !catalog.lessonRefs.every((x) => id(x?.lessonId) && id(x?.version))
    || !Array.isArray(catalog.allowedProblemIds) || !catalog.allowedProblemIds.every(id) || !Array.isArray(catalog.sources)
    || !catalog.sources.length || !catalog.sources.every(safeSource)) return null
  return { title: catalog.title, deadline: typeof catalog.deadline === 'string' ? catalog.deadline : null,
    gradeLevels: catalog.gradeLevels, lessonRefs: catalog.lessonRefs.map(({ lessonId, version }) => ({ lessonId, version })),
    allowedProblemIds: catalog.allowedProblemIds, sources: catalog.sources.map(({ title, url }) => ({ title, url })) }
}


/** Trusted Admin SDK only. Direct clients must never read lesson definitions or attempts. */
export function createFirestoreLessonAdapter(db) {
  if (!db || typeof db.doc !== 'function' || typeof db.runTransaction !== 'function') throw new Error('Invalid Firestore adapter')
  const ref = (path) => db.doc(path)
  const base = (s) => `families/${s.familyId}/children/${s.childId}/olympiads/${s.olympiadId}`
  const materialRef = (s, lessonId, version) => ref(`olympiadMaterials/${s.olympiadId}/lessons/${lessonId}/versions/${version}`)
  const attemptRef = (s) => ref(`${base(s)}/attempts/${s.attemptId}`)
  const data = (snap) => snap?.exists ? snap.data() : null
  const read = async (reader, path) => data(await reader.get(ref(path)))

  async function membership(reader, principal, s, action) {
    if (!scopeOK(s) || !id(principal?.uid)) return false
    const session = await read(reader, `deviceSessions/${principal.uid}`)
    if (!token(session?.linkToken)) return false
    const link = await read(reader, `accessLinks/${session.linkToken}`)
    if (link?.active !== true || !id(link.personId)) return false
    const [family, child, member] = await Promise.all([
      read(reader, `families/${s.familyId}`), read(reader, `families/${s.familyId}/children/${s.childId}`),
      read(reader, `families/${s.familyId}/members/${link.personId}`),
    ])
    if (!family || family.active === false || !child || child.active === false || member?.active !== true || !Array.isArray(member.childIds) || !member.childIds.includes(s.childId)) return false
    return action === 'view' ? ['parent', 'student'].includes(member.role) : action === 'parent' ? member.role === 'parent' : member.role === 'student'
  }
  async function materialAllowed(reader, s, lessonId, version, requireParticipation = false) {
    if (!scopeOK(s) || !id(lessonId) || !id(version)) return false
    const [assignment, material, rawCatalog, child] = await Promise.all([read(reader, base(s)), reader.get(materialRef(s, lessonId, version)).then(data),
      read(reader, `olympiadCatalog/${s.olympiadId}`), read(reader, `families/${s.familyId}/children/${s.childId}`)])
    const catalog = checkedCatalog(rawCatalog)
    return catalog && eligibility(child, catalog) === 'eligible' && catalog.lessonRefs.some((x) => x.lessonId === lessonId && x.version === version)
      && assignment?.active === true && (!requireParticipation || assignment.participationEnabled === true) && Array.isArray(assignment.allowedLessonIds) && assignment.allowedLessonIds.includes(lessonId)
      && material?.status === 'published' && material.practiceOnly === true && lessonOK(material.lesson, lessonId, version)
  }
  const reader = { get: (r) => r.get() }
  return {
    authorize: (principal, scope, action) => membership(reader, principal, scope, action),
    authorizeLesson: (principal, scope, lesson) => materialAllowed(reader, scope, lesson?.id, lesson?.version),
    async readAttempt(scope) {
      if (!scopeOK(scope)) return null
      return data(await attemptRef(scope).get())
    },
    async readLesson({ olympiadId, lessonId, version }) {
      if (![olympiadId, lessonId, version].every(id)) return null
      const material = data(await materialRef({ olympiadId }, lessonId, version).get())
      return material?.status === 'published' && material.practiceOnly === true && lessonOK(material.lesson, lessonId, version) ? material.lesson : null
    },
    async compareAndSwap({ principal, scope, action, expectedRevision, attempt }) {
      if (!scopeOK(scope) || !attempt || !['start', 'act'].includes(action)
        || !['familyId', 'childId', 'olympiadId', 'attemptId'].every((k) => attempt[k] === scope[k])
        || !id(attempt.lessonId) || !id(attempt.lessonVersion)) unavailable()
      return db.runTransaction(async (tx) => {
        if (!await membership(tx, principal, scope, action) || !await materialAllowed(tx, scope, attempt.lessonId, attempt.lessonVersion, true)) unavailable()
        const current = data(await tx.get(attemptRef(scope)))
        if ((current?.revision ?? null) !== expectedRevision) return false
        if (current && (current.attempt?.lessonId !== attempt.lessonId || current.attempt?.lessonVersion !== attempt.lessonVersion)) unavailable()
        tx.set(attemptRef(scope), { revision: expectedRevision === null ? 0 : expectedRevision + 1, attempt })
        return true
      })
    },
  }
}

export function createFirestoreLessonService(db) { return createLessonService(createFirestoreLessonAdapter(db)) }

/** Safe family catalog: the caller has already verified the Firebase UID. */
export async function listFirestoreOlympiads(db, principal, familyId, childId) {
  const scope = { familyId, childId, olympiadId: 'catalog', attemptId: 'catalog' }
  const adapter = createFirestoreLessonAdapter(db)
  if (!await adapter.authorize(principal, scope, 'view')) unavailable()
  const isParent = await adapter.authorize(principal, scope, 'parent')
  const [catalogSnapshot, childSnap, assignments] = await Promise.all([
    db.collection('olympiadCatalog').get(), db.doc(`families/${familyId}/children/${childId}`).get(),
    db.collection(`families/${familyId}/children/${childId}/olympiads`).get(),
  ])
  const child = childSnap.data()
  const assignmentMap = new Map(assignments.docs.map((doc) => [doc.id, doc.data()]))
  const result = []
  for (const doc of catalogSnapshot.docs) {
    const catalog = checkedCatalog(doc.data())
    if (!id(doc.id) || !catalog) continue
    const eligible = eligibility(child, catalog)
    const assignment = assignmentMap.get(doc.id)
    const participating = assignment?.active === true && assignment.participationEnabled === true
    if (eligible === 'ineligible' || (!isParent && (!participating || eligible !== 'eligible'))) continue
    const lessons = []
    for (const item of catalog.lessonRefs) {
      const lesson = await adapter.readLesson({ olympiadId: doc.id, ...item })
      const actualScope = { ...scope, olympiadId: doc.id }
      // Without an assignment the parent can see a catalog entry, but no lesson is assigned yet.
      if (lesson && await adapter.authorizeLesson(principal, actualScope, lesson)) lessons.push({ id: lesson.id, version: lesson.version, title: lesson.title, topicId: lesson.topicId })
    }
    result.push({ id: doc.id, title: catalog.title, deadline: catalog.deadline, eligibility: eligible, participationEnabled: participating, sources: catalog.sources, lessons })
  }
  if (!await adapter.authorize(principal, scope, 'view') || (isParent && !await adapter.authorize(principal, scope, 'parent'))) unavailable()
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

/** Only an authorized parent may alter participation; this does not remove history. */
export async function setFirestoreOlympiadParticipation(db, principal, scope, enabled) {
  if (!scopeOK(scope) || typeof enabled !== 'boolean') unavailable()
  const adapter = createFirestoreLessonAdapter(db)
  if (!await adapter.authorize(principal, scope, 'parent')) unavailable()
  return db.runTransaction(async (tx) => {
    const tdb = { doc: (path) => ({ get: () => tx.get(db.doc(path)) }), runTransaction: db.runTransaction.bind(db) }
    const transactionalAdapter = createFirestoreLessonAdapter(tdb)
    if (!await transactionalAdapter.authorize(principal, scope, 'parent')) unavailable()
    const assignmentRef = db.doc(`families/${scope.familyId}/children/${scope.childId}/olympiads/${scope.olympiadId}`)
    const [snap, catalogSnap, childSnap] = await Promise.all([tx.get(assignmentRef), tx.get(db.doc(`olympiadCatalog/${scope.olympiadId}`)), tx.get(db.doc(`families/${scope.familyId}/children/${scope.childId}`))])
    const existing = snap.exists ? snap.data() : null
    if (!enabled) {
      if (!existing || existing.active !== true) unavailable()
      tx.update(assignmentRef, { participationEnabled: false })
      return { participationEnabled: false }
    }
    const catalog = checkedCatalog(catalogSnap.data())
    if (!catalog || eligibility(childSnap.data(), catalog) !== 'eligible') unavailable()
    tx.set(assignmentRef, { ...(existing || {}), active: true, participationEnabled: true, title: catalog.title, deadline: catalog.deadline,
      lessonRefs: catalog.lessonRefs, allowedLessonIds: [...new Set(catalog.lessonRefs.map(x => x.lessonId))],
      allowedProblemIds: catalog.allowedProblemIds, sources: catalog.sources })
    return { participationEnabled: true }
  })
}

/** Parent details are never returned to the student projection. */
export async function readFirestoreParentLesson(db, principal, scope) {
  const adapter = createFirestoreLessonAdapter(db)
  if (!await adapter.authorize(principal, scope, 'parent')) unavailable()
  const record = await adapter.readAttempt(scope)
  if (!record?.attempt || !['familyId', 'childId', 'olympiadId', 'attemptId'].every((k) => record.attempt[k] === scope[k])) unavailable()
  const lesson = await adapter.readLesson({ olympiadId: scope.olympiadId, lessonId: record.attempt.lessonId, version: record.attempt.lessonVersion })
  if (!lesson || !await adapter.authorizeLesson(principal, scope, lesson)) unavailable()
  const result = { view: studentLessonView(lesson, record.attempt), steps: lesson.steps, events: record.attempt.events }
  if (!await adapter.authorize(principal, scope, 'parent') || !await adapter.authorizeLesson(principal, scope, lesson)) unavailable()
  return result
}

/** Family-scoped attempt index for resume. No raw answers or keys leave this route. */
export async function listFirestoreLessonAttempts(db, principal, scope) {
  if (!scopeOK(scope)) unavailable()
  const adapter = createFirestoreLessonAdapter(db)
  if (!await adapter.authorize(principal, scope, 'view')) unavailable()
  const base = `families/${scope.familyId}/children/${scope.childId}/olympiads/${scope.olympiadId}`
  const snapshot = await db.collection(`${base}/attempts`).get()
  const result = []
  for (const doc of snapshot.docs) {
    const a = doc.data()?.attempt
    if (!id(doc.id) || !a || a.attemptId !== doc.id || !['familyId', 'childId', 'olympiadId'].every((k) => a[k] === scope[k]) || !['active', 'completed'].includes(a.status)) continue
    const lesson = await adapter.readLesson({ olympiadId: scope.olympiadId, lessonId: a.lessonId, version: a.lessonVersion })
    if (lesson && await adapter.authorizeLesson(principal, scope, lesson)) result.push({ attemptId: a.attemptId, lessonId: a.lessonId, lessonVersion: a.lessonVersion, status: a.status })
  }
  if (!await adapter.authorize(principal, scope, 'view')) unavailable()
  return result.sort((a, b) => a.attemptId.localeCompare(b.attemptId))
}
