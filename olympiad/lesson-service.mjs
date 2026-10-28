/* @see ../docs/modules/assessments/olympiad-preparation.md */
/**
 * Server-only orchestration for the lesson aggregate. Ports must be trusted:
 * authorize obtains current membership from the authority, while compareAndSwap
 * must perform the revision check AND current membership and material authorization at the storage boundary in
 * one transaction. Never accept a role or authorization decision from the client.
 * @see ../docs/shared/access-and-privacy.md
 */
import { applyLessonCommand, startAttempt, studentLessonView } from './lesson.mjs'

const missing = () => { throw new Error('Lesson unavailable') }
const validScope = (scope) => scope && ['familyId', 'childId', 'olympiadId', 'attemptId'].every((key) => typeof scope[key] === 'string' && scope[key].trim())
const matches = (attempt, scope) => attempt && ['familyId', 'childId', 'olympiadId', 'attemptId'].every((key) => attempt[key] === scope[key])

export function createLessonService({ authorize, authorizeLesson, readAttempt, readLesson, compareAndSwap, maxRetries = 5 }) {
  if (![authorize, authorizeLesson, readAttempt, readLesson, compareAndSwap].every((port) => typeof port === 'function') || !Number.isInteger(maxRetries) || maxRetries < 1) throw new Error('Invalid lesson ports')
  async function permitted(principal, scope, action) {
    if (!principal || !validScope(scope) || await authorize(principal, scope, action) !== true) missing()
  }
  async function permittedLesson(principal, scope, lesson) {
    if (await authorizeLesson(principal, scope, lesson) !== true) missing()
  }
  async function loaded(principal, scope, action) {
    await permitted(principal, scope, action)
    const record = await readAttempt(scope)
    if (!record || !matches(record.attempt, scope) || !Number.isInteger(record.revision) || record.revision < 0) missing()
    const lesson = await readLesson({ olympiadId: scope.olympiadId, lessonId: record.attempt.lessonId, version: record.attempt.lessonVersion })
    if (!lesson || lesson.id !== record.attempt.lessonId || lesson.version !== record.attempt.lessonVersion) missing()
    await permittedLesson(principal, scope, lesson)
    return { ...record, lesson }
  }
  return {
    async view(principal, scope) {
      const { lesson, attempt } = await loaded(principal, scope, 'view')
      const result = studentLessonView(lesson, attempt)
      // Revocation during the read must not result in delivering a stale view.
      await permitted(principal, scope, 'view')
      await permittedLesson(principal, scope, lesson)
      return result
    },
    async start(principal, scope, lessonRef) {
      await permitted(principal, scope, 'start')
      if (!lessonRef || typeof lessonRef.lessonId !== 'string' || typeof lessonRef.version !== 'string') missing()
      const lesson = await readLesson({ olympiadId: scope.olympiadId, lessonId: lessonRef.lessonId, version: lessonRef.version })
      if (!lesson || lesson.id !== lessonRef.lessonId || lesson.version !== lessonRef.version) missing()
      await permittedLesson(principal, scope, lesson)
      const attempt = startAttempt(lesson, scope)
      await permitted(principal, scope, 'start')
      // A failed CAS may mean a simultaneous retry. Re-read through the same
      // access path and accept only the same lesson version and exact scope.
      if (!await compareAndSwap({ principal, scope, action: 'start', expectedRevision: null, attempt })) {
        const existing = await loaded(principal, scope, 'start')
        if (existing.attempt.lessonId !== lesson.id || existing.attempt.lessonVersion !== lesson.version) missing()
        await permitted(principal, scope, 'start')
        await permittedLesson(principal, scope, existing.lesson)
        return studentLessonView(existing.lesson, existing.attempt)
      }
      await permitted(principal, scope, 'view')
      await permittedLesson(principal, scope, lesson)
      return studentLessonView(lesson, attempt)
    },
    async act(principal, scope, command) {
      for (let i = 0; i < maxRetries; i++) {
        const { lesson, attempt, revision } = await loaded(principal, scope, 'act')
        const next = applyLessonCommand(lesson, attempt, command)
        // Even an idempotent replay cannot bypass an authorization check.
        if (next === attempt) {
          await permitted(principal, scope, 'view')
          await permittedLesson(principal, scope, lesson)
          return studentLessonView(lesson, attempt)
        }
        await permitted(principal, scope, 'act')
        if (await compareAndSwap({ principal, scope, action: 'act', expectedRevision: revision, attempt: next })) {
          await permitted(principal, scope, 'view')
          await permittedLesson(principal, scope, lesson)
          return studentLessonView(lesson, next)
        }
      }
      throw new Error('Lesson update conflict')
    },
  }
}
