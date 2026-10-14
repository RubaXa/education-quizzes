import { collection, doc, getDocFromServer, getDocs, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { currentEducationPersonId } from './personalAccess'
import type { DayWorkReview } from './dayStore'

/** A parent's completion decision is separate from the evidence-based review. @see ../../docs/product/day-page.md#parent-acceptance */
export type ParentCompletionEvent = {
  id: string
  taskId: string
  action: 'accept' | 'reopen' | 'require' | 'optional' | 'stage-required' | 'stage-optional' | 'variant-required' | 'variant-optional'
  requirementId?: string
  variantId?: string
  stageId?: string
  stageIndex?: number
  guideRevision?: number
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

/** Only the latest choice for this exact review version and proposal applies. @see ../../docs/product/review-criteria-provenance.md#family-disputes */
export function requirementChoice(review: DayWorkReview | undefined, requirementId: string, events: ParentCompletionEvent[]): 'require' | 'optional' | undefined {
  if (!review?.assessmentBasis?.disputedRequirements?.some((item) => item.id === requirementId)) return undefined
  const version = stamp(review.checkedAt)
  const token = review.id.split(':')[0]
  const related = events.filter((event) => event.id.startsWith(`${token}:`) && event.taskId === review.taskId
    && event.requirementId === requirementId && ['require', 'optional'].includes(event.action)
    && stamp(event.reviewCheckedAt) === version && stamp(event.decidedAt))
    .sort((a, b) => stamp(b.decidedAt).localeCompare(stamp(a.decidedAt)) || b.id.localeCompare(a.id))
  return related[0]?.action as 'require' | 'optional' | undefined
}

export function requiredFamilyActions(review: DayWorkReview | undefined, events: ParentCompletionEvent[]): string[] {
  return review?.assessmentBasis?.disputedRequirements?.filter((item) => requirementChoice(review, item.id, events) === 'require').map((item) => item.action) ?? []
}

/** Family practice is selected before a photo exists; the teacher assignment stays intact.
 * @see ../../docs/product/card-generation-policy.md#practice-variants */
export function variantRequired(taskId: string, variantId: string, events: ParentCompletionEvent[]): boolean {
  const latest = events.filter((event) => event.taskId === taskId && event.variantId === variantId
    && ['variant-required', 'variant-optional'].includes(event.action) && stamp(event.decidedAt))
    .sort((a, b) => stamp(b.decidedAt).localeCompare(stamp(a.decidedAt)) || b.id.localeCompare(a.id))[0]
  return latest?.action !== 'variant-optional'
}

export async function recordVariantChoice(studentToken: string, taskId: string, variantId: string, required: boolean) {
  if (!studentToken || !variantId.startsWith(`${taskId}-v`)) throw new Error('Вариант не связан с заданием.')
  await writeBatch(db).set(doc(db, 'dayParentDecisions', studentToken, 'events', crypto.randomUUID()), {
    taskId, variantId, action: required ? 'variant-required' : 'variant-optional', reviewCheckedAt: null,
    actorPersonId: currentEducationPersonId(), decidedAt: serverTimestamp(),
  }).commit()
}

/** A reviewed stage is required until a parent explicitly excludes it for this review version.
 * @see ../../docs/product/day-page.md#review-stage-switch */
export function stageRequired(review: DayWorkReview | undefined, stageId: string, events: ParentCompletionEvent[]): boolean {
  if (!review?.checkableStageIds?.includes(stageId)) return true
  const version = stamp(review.checkedAt)
  const token = review.id.split(':')[0]
  const latest = events.filter((event) => event.id.startsWith(`${token}:`) && event.taskId === review.taskId
    && event.stageId === stageId && ['stage-required', 'stage-optional'].includes(event.action)
    && stamp(event.reviewCheckedAt) === version && stamp(event.decidedAt))
    .sort((a, b) => stamp(b.decidedAt).localeCompare(stamp(a.decidedAt)) || b.id.localeCompare(a.id))[0]
  return latest?.action !== 'stage-optional'
}

export function stageCompletion(review: DayWorkReview | undefined, events: ParentCompletionEvent[]) {
  const ids = review?.checkableStageIds
  if (!ids?.length || new Set(ids).size !== ids.length) return null
  const items = review?.items ?? []
  const required = ids.filter((id) => stageRequired(review, id, events))
  const confirmed = required.filter((id) => {
    const matched = items.filter((item) => item.stageId === id)
    return matched.length > 0 && matched.every((item) => item.status === 'correct')
  })
  return { required: required.length, confirmed: confirmed.length,
    optional: ids.length - required.length, complete: confirmed.length === required.length }
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
  if (action !== 'accept' && action !== 'reopen') throw new Error('Неверный тип решения родителя.')
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

/** Parent sets a family requirement without changing the source review or attributing it to the teacher. */
export async function recordRequirementChoice(review: DayWorkReview, requirementId: string, action: 'require' | 'optional') {
  const proposal = review.assessmentBasis?.disputedRequirements?.find((item) => item.id === requirementId)
  if (!proposal || review.assessmentBasis?.outcome !== 'unresolved' || !stamp(review.checkedAt)) throw new Error('Спорное требование не найдено в текущем разборе.')
  const actorPersonId = currentEducationPersonId()
  const studentToken = review.id.split(':')[0]
  if (!studentToken || !review.id.includes(':')) throw new Error('Не найдена исходная страница проверки.')
  const latest = await getDocFromServer(doc(db, 'dayProgress', studentToken, 'items', review.taskId))
  if (!latest.exists() || latest.data().assessmentBasis?.outcome !== 'unresolved'
    || stamp(latest.data().checkedAt) !== stamp(review.checkedAt)
    || !latest.data().assessmentBasis?.disputedRequirements?.some((item: { id: string }) => item.id === requirementId)) throw new Error('Разбор изменился. Откройте свежую версию карточки.')
  const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
  const { familyId, childId, targetDate: date } = owner.data() ?? {}
  if (!owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string' || typeof date !== 'string') throw new Error('Семейная привязка работы не найдена.')
  const members = await getDocs(collection(db, 'families', familyId, 'members'))
  const learners = members.docs.filter((member) => member.data().active === true && member.data().role === 'student' && member.data().childIds?.includes(childId))
  if (!learners.length) throw new Error('Профиль ученика для уведомления не найден.')
  const eventId = crypto.randomUUID()
  const batch = writeBatch(db)
  batch.set(doc(db, 'dayParentDecisions', studentToken, 'events', eventId), {
    taskId: review.taskId, requirementId, action, reviewCheckedAt: review.checkedAt, actorPersonId, decidedAt: serverTimestamp(),
  })
  for (const learner of learners) batch.set(doc(db, 'users', learner.id, 'inbox', eventId), {
    familyId, childId, type: action === 'require' ? 'parent_requirement_mandatory' : 'parent_requirement_optional',
    entityId: review.taskId, taskId: review.taskId, studentToken, eventId, date,
    sourceRevision: 1, createdAt: serverTimestamp(),
  })
  await batch.commit()
}

/** One immutable family choice, validated against the current private guide by Firestore rules.
 * No profile or membership scan is needed for the write. */
export async function recordStageChoice(review: DayWorkReview, guide: { revision?: number; stages: { id: string }[] }, stageId: string, required: boolean) {
  if (!review.checkableStageIds?.includes(stageId) || !stamp(review.checkedAt)) throw new Error('Пункт не связан с текущей проверкой.')
  const stageIndex = guide.stages.findIndex((stage) => stage.id === stageId)
  if (stageIndex < 0 || !Number.isInteger(guide.revision) || !review.id.includes(':')) throw new Error('Не найдена текущая версия разбора.')
  const studentToken = review.id.split(':')[0]
  await writeBatch(db).set(doc(db, 'dayParentDecisions', studentToken, 'events', crypto.randomUUID()), {
    taskId: review.taskId, action: required ? 'stage-required' : 'stage-optional', stageId, stageIndex,
    guideRevision: guide.revision, reviewCheckedAt: review.checkedAt,
    actorPersonId: currentEducationPersonId(), decidedAt: serverTimestamp(),
  }).commit()
}
