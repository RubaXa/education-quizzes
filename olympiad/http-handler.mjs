/* @see ../docs/modules/assessments/olympiad-preparation.md */
import { submitOlympiadHelp, registerOlympiadPhoto, readOlympiadHelp, transferOlympiadPhoto, readOlympiadPhoto, listOlympiadProblems, listOlympiadHelp } from '../sync/olympiad-help.mjs'
import { createFirestoreLessonService, listFirestoreOlympiads, setFirestoreOlympiadParticipation, readFirestoreParentLesson, listFirestoreLessonAttempts } from './firestore-lesson-adapter.mjs'

/** Framework-neutral JSON handler. Mount only behind HTTPS and same-origin CSRF/CORS controls.
 * auth.verifyIdToken must be the Firebase Admin verifier; no request role is trusted. */
export function createOlympiadHttpHandler({ db, auth, photoStorage }) {
  if (typeof auth?.verifyIdToken !== 'function') throw new Error('Firebase verifier required')
  const service = createFirestoreLessonService(db)
  return async function handle({ method, authorization, body, bytes, transport }) {
    if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } }
    const match = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization)
    if (!match) return { status: 401, body: { error: 'unauthorized' } }
    let principal
    try { principal = await auth.verifyIdToken(match[1], true) } catch { return { status: 401, body: { error: 'unauthorized' } } }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'invalid_request' } }
    try {
      let result
      if (body.action === 'photo-upload' && transport === 'binary' && photoStorage) result = await transferOlympiadPhoto(db, photoStorage, { ...body.request, uid: principal.uid }, bytes)
      else if (body.action === 'photo-read' && transport === 'binary' && photoStorage) {
        const photo = await readOlympiadPhoto(db, photoStorage, { ...body.request, uid: principal.uid })
        return { status: 200, binary: photo.bytes, contentType: photo.mime }
      }
      else if (body.action === 'list') result = await listFirestoreOlympiads(db, principal, body.familyId, body.childId)
      else if (body.action === 'list-problems') result = await listOlympiadProblems(db, { ...body.scope, uid: principal.uid })
      else if (body.action === 'list-help') result = await listOlympiadHelp(db, { ...body.scope, uid: principal.uid })
      else if (body.action === 'register-photo') result = await registerOlympiadPhoto(db, { ...body.request, uid: principal.uid })
      else if (body.action === 'read-help') result = await readOlympiadHelp(db, { ...body.request, uid: principal.uid })
      else if (body.action === 'submit-help') result = await submitOlympiadHelp(db, { ...body.request, uid: principal.uid })
      else if (body.action === 'list-attempts') result = await listFirestoreLessonAttempts(db, principal, body.scope)
      else if (body.action === 'participation') result = await setFirestoreOlympiadParticipation(db, principal, body.scope, body.enabled)
      else if (body.action === 'parent-detail') result = await readFirestoreParentLesson(db, principal, body.scope)
      else if (body.action === 'view') result = await service.view(principal, body.scope)
      else if (body.action === 'start') result = await service.start(principal, body.scope, body.lessonRef)
      else if (body.action === 'act') result = await service.act(principal, body.scope, body.command)
      else return { status: 400, body: { error: 'invalid_request' } }
      return { status: 200, body: { result } }
    } catch {
      // Do not reveal identity, membership, keys, or internal errors to an unauthorized caller.
      return { status: 404, body: { error: 'unavailable' } }
    }
  }
}
