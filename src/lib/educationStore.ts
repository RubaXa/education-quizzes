import { getAuth, onAuthStateChanged } from 'firebase/auth'
import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { currentEducationPersonId, restorePersonalSession } from './personalAccess'
import { parseScreenManifest } from './educationSchema'
import type { ActivityType, EducationDay, EducationTask, InboxNotification, ScreenManifest, ScreenView, ViewReceipt } from './educationSchema'

function segment(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(value)) throw new Error('Некорректный идентификатор данных Education.')
  return value
}

function signedInUid(): string {
  const uid = getAuth().currentUser?.uid
  if (!uid) throw new Error('Для этой страницы нужен вход в Education.')
  return uid
}

/** @see ../../docs/architecture/family-data-model.md#authorization */
export function watchEducationUser(onChange: (personId: string | null) => void) {
  return onAuthStateChanged(getAuth(), (user) => {
    if (!user) { onChange(null); return }
    void restorePersonalSession().then((session) => onChange(session?.personId ?? null)).catch(() => onChange(null))
  })
}

/** @see ../../docs/architecture/backend-driven-ui.md#manifest */
export function watchScreenManifest(familyId: string, view: ScreenView, onChange: (manifest: ScreenManifest) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'families', segment(familyId), 'ui', view), (snapshot) => {
    if (!snapshot.exists()) { onError(new Error('Настройки экрана ещё не опубликованы.')); return }
    try { onChange(parseScreenManifest(snapshot.data(), view)) }
    catch (cause) { onError(cause instanceof Error ? cause : new Error('Не удалось прочитать настройки экрана.')) }
  }, onError)
}

/** @see ../../docs/architecture/family-data-model.md#collections */
export function watchEducationDay(familyId: string, childId: string, date: string, onChange: (day: EducationDay | null) => void, onError: (error: Error) => void) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Некорректная дата учебного дня.')
  return onSnapshot(doc(db, 'families', segment(familyId), 'children', segment(childId), 'days', date),
    (snapshot) => onChange(snapshot.exists() ? snapshot.data() as EducationDay : null), onError)
}

/** @see ../../docs/architecture/family-data-model.md#collections */
export function watchEducationTask(familyId: string, childId: string, taskId: string, onChange: (task: EducationTask | null) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'families', segment(familyId), 'children', segment(childId), 'tasks', segment(taskId)),
    (snapshot) => onChange(snapshot.exists() ? snapshot.data() as EducationTask : null), onError)
}

let sessionId: string | null = null
const emittedInSession = new Set<string>()
function currentSessionId(): string {
  if (!sessionId) sessionId = crypto.randomUUID()
  return sessionId
}

/**
 * Неуспех телеметрии не должен отменять предметное действие; вызывающий код
 * решает, где показать техническую ошибку и когда повторить запись.
 * @see ../../docs/architecture/activity-and-inbox.md#events
 */
export async function recordActivity(input: {
  familyId: string
  childId: string
  type: ActivityType
  viewId: ScreenView
  sectionId?: string
  entityId?: string
}) {
  const deviceUid = signedInUid()
  const actorPersonId = currentEducationPersonId()
  const eventId = crypto.randomUUID()
  await setDoc(doc(collection(db, 'families', segment(input.familyId), 'activity'), eventId), {
    schemaVersion: 1,
    actorPersonId,
    deviceUid,
    childId: segment(input.childId),
    type: input.type,
    viewId: input.viewId,
    sectionId: input.sectionId ?? '',
    entityId: input.entityId ?? '',
    sessionId: currentSessionId(),
    occurredAt: serverTimestamp(),
  })
  return eventId
}

/** @see ../../docs/architecture/activity-and-inbox.md#events */
export async function recordActivityOnce(input: Parameters<typeof recordActivity>[0]) {
  const key = [input.familyId, input.childId, input.type, input.viewId, input.sectionId ?? '', input.entityId ?? ''].join('|')
  if (emittedInSession.has(key)) return
  emittedInSession.add(key)
  try { await recordActivity(input) }
  catch (cause) { emittedInSession.delete(key); throw cause }
}

/** @see ../../docs/architecture/activity-and-inbox.md#read-state */
export async function markSectionSeen(viewKey: string, sourceRevision: number) {
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) throw new Error('Некорректная версия раздела.')
  const personId = currentEducationPersonId()
  const reference = doc(db, 'users', personId, 'views', segment(viewKey))
  await runTransaction(db, async (transaction) => {
    const previous = await transaction.get(reference)
    if ((previous.data()?.sourceRevision ?? -1) > sourceRevision) return
    transaction.set(reference, { sourceRevision, seenAt: serverTimestamp() })
  })
}

/** @see ../../docs/architecture/activity-and-inbox.md#read-state */
export async function markNotificationRead(notificationId: string) {
  const personId = currentEducationPersonId()
  await updateDoc(doc(db, 'users', personId, 'inbox', segment(notificationId)), { readAt: serverTimestamp() })
}

/** @see ../../docs/architecture/activity-and-inbox.md#read-state */
export function watchInbox(onChange: (notifications: Array<InboxNotification & { id: string }>) => void, onError: (error: Error) => void) {
  const personId = currentEducationPersonId()
  const reference = query(collection(db, 'users', personId, 'inbox'), orderBy('createdAt', 'desc'), limit(100))
  return onSnapshot(reference, (snapshot) => onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as InboxNotification & { id: string }))), onError)
}

/** @see ../../docs/architecture/activity-and-inbox.md#read-state */
export function watchViewReceipt(viewKey: string, onChange: (receipt: ViewReceipt | null) => void, onError: (error: Error) => void) {
  const personId = currentEducationPersonId()
  return onSnapshot(doc(db, 'users', personId, 'views', segment(viewKey)),
    (snapshot) => onChange(snapshot.exists() ? snapshot.data() as ViewReceipt : null), onError)
}
