import { collection, doc, getDocFromServer, getDocs, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { currentEducationPersonId } from './personalAccess'
import type { DayWorkReview } from './dayStore'

/** A parent's completion decision is separate from the evidence-based review. @see ../../docs/product/day-page.md#parent-acceptance */
export type ParentCompletionEvent = {
  id: string
  taskId: string
  action: 'accept' | 'reopen'
  reviewCheckedAt: unknown
  decidedAt: unknown
}

function stamp(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const date = value as { seconds?: number; nanoseconds?: number; _seconds?: number; _nanoseconds?: number }
  const seconds = date.seconds ?? date._seconds
  const nanos = date.nanoseconds ?? date._nanoseconds
  return typeof seconds === 'number' && typeof nanos === 'number' ? `${String(seconds).padStart(12, '0')}:${String(nanos).padStart(9, '0')}` : ''
}

export function canAcceptCorrectAnswer(review?: DayWorkReview): boolean {
  const reasoning = review?.mathReasoning
  return review?.status === 'partial' && reasoning?.answer === 'correct'
    && ['met', 'not-met'].includes(review.assessmentBasis?.outcome ?? '')
    && ['incomplete', 'not-shown', 'unreadable'].includes(reasoning.argument)
    && Boolean(stamp(review.checkedAt))
}

export function parentAccepted(review: DayWorkReview | undefined, events: ParentCompletionEvent[]): boolean {
  if (!canAcceptCorrectAnswer(review)) return false
  const version = stamp(review?.checkedAt)
  const studentToken = review?.id.split(':')[0]
  const related = events.filter((event) => event.id.startsWith(`${studentToken}:`) && event.taskId === review?.taskId && stamp(event.reviewCheckedAt) === version && stamp(event.decidedAt))
    .sort((a, b) => (stamp(b.decidedAt) || '').localeCompare(stamp(a.decidedAt) || '') || b.id.localeCompare(a.id))
  return related[0]?.action === 'accept'
}

export function watchParentCompletions(tokens: string[], onChange: (events: ParentCompletionEvent[]) => void, onError: (error: Error) => void) {
  const unique = [...new Set(tokens)]
  const parts = new Map<string, ParentCompletionEvent[]>()
  const stops = unique.map((studentToken) => onSnapshot(collection(db, 'dayParentDecisions', studentToken, 'events'), (snapshot) => {
    parts.set(studentToken, snapshot.docs.map((item) => ({ id: `${studentToken}:${item.id}`, ...item.data() } as ParentCompletionEvent)))
    if (parts.size === unique.length) onChange(unique.flatMap((token) => parts.get(token) ?? []))
  }, onError))
  return () => stops.forEach((stop) => stop())
}

export async function recordParentCompletion(review: DayWorkReview, action: ParentCompletionEvent['action']) {
  const actorPersonId = currentEducationPersonId()
  if (!canAcceptCorrectAnswer(review)) throw new Error('Верный ответ с неполным ходом не подтверждён в текущем разборе.')
  const studentToken = review.id.split(':')[0]
  if (!studentToken || !review.id.includes(':')) throw new Error('Не найдена исходная страница проверки.')
  const latest = await getDocFromServer(doc(db, 'dayProgress', studentToken, 'items', review.taskId))
  if (!latest.exists() || !canAcceptCorrectAnswer(latest.data() as DayWorkReview)
    || stamp(latest.data().checkedAt) !== stamp(review.checkedAt)) throw new Error('Разбор изменился. Откройте свежую версию карточки.')
  const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
  const familyId = owner.data()?.familyId
  const childId = owner.data()?.childId
  const date = owner.data()?.targetDate
  if (!owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string' || typeof date !== 'string') throw new Error('Семейная привязка работы не найдена.')
  const members = await getDocs(collection(db, 'families', familyId, 'members'))
  const learners = members.docs.filter((member) => member.data().active === true
    && member.data().role === 'student' && member.data().childIds?.includes(childId))
  if (!learners.length) throw new Error('Профиль ученика для уведомления не найден.')
  const eventId = crypto.randomUUID()
  const batch = writeBatch(db)
  batch.set(doc(db, 'dayParentDecisions', studentToken, 'events', eventId), {
    taskId: review.taskId, action, reviewCheckedAt: review.checkedAt, actorPersonId, decidedAt: serverTimestamp(),
  })
  for (const learner of learners) batch.set(doc(db, 'users', learner.id, 'inbox', eventId), {
    familyId, childId, type: action === 'accept' ? 'parent_accepted' : 'parent_reopened',
    entityId: review.taskId, taskId: review.taskId, studentToken, eventId, date,
    sourceRevision: 1, createdAt: serverTimestamp(),
  })
  await batch.commit()
}
