import { collection, doc, getDocFromServer, getDocs, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from './firebase'
/** @see ../../docs/decisions/released-stage-parity-2026-10-20.md */
import { currentEducationPersonId } from './personalAccess'
import type { DayGuidanceRevealContent, ParentTaskGuide } from './dayStore'
import { projectGuidanceReveal } from '../../day/guidance-release.mjs'
import { prepareEducationEvent, stagePreparedEducationEvent } from './educationEventProducer'

export type DayGuidance = {
  id: string; taskId: string; stageId: string; stageIndex: number; level: 'hint' | 'reveal';
  text: string; guideRevision: number; actorPersonId: string; createdAt: unknown; sourceRequestEventId?: string;
  /** Present only for a parent-selected full reveal; contains one stage's public allowlisted fields. */
  revealContent?: DayGuidanceRevealContent;
  reviewResponse?: import('../../packages/education-presentation/review-reply.mjs').ReviewResponse;
  reviewContext?: {checkedAt:unknown;correctedAt:unknown};
}

function guidanceTime(item: DayGuidance) {
  const stamp = item.createdAt as { toMillis?: () => number; seconds?: number; nanoseconds?: number } | undefined
  return stamp?.toMillis?.() ?? (stamp?.seconds ?? 0) * 1000 + (stamp?.nanoseconds ?? 0) / 1_000_000
}
/** Stable ordering for separately written help levels sharing a Firestore timestamp second. */
export function compareDayGuidanceChronology(a: DayGuidance, b: DayGuidance) {
  return guidanceTime(a) - guidanceTime(b)
    || (a.level === b.level ? 0 : a.level === 'hint' ? -1 : 1)
    || a.id.localeCompare(b.id)
}

/** Read-only on the learner route; the guide and neighboring stages remain private.
 * @see ../../docs/modules/reviews/subject-aware-guidance.md#math-route */
export function watchDayGuidance(studentToken: string, onChange: (items: DayGuidance[]) => void, onError: (error: Error) => void) {
  return onSnapshot(collection(db, 'dayGuidance', studentToken, 'items'), (snapshot) => {
    onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as DayGuidance)).sort(compareDayGuidanceChronology))
  }, onError)
}

/** One immutable event per stage, wording, reveal snapshot and help level. */
async function guidanceEventId(studentToken: string, taskId: string, stage: ParentTaskGuide['stages'][number], level: DayGuidance['level']) {
  const selectedReveal = level === 'reveal' ? projectGuidanceReveal(stage) : null
  const source = JSON.stringify([studentToken, taskId, stage.id, stage.hintPreview ?? '', stage.revealPreview ?? '', level, selectedReveal])
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function sendDayGuidance(studentToken: string, taskId: string, guide: ParentTaskGuide, stageId: string, level: DayGuidance['level']) {
  const stageIndex = guide.stages.findIndex((stage) => stage.id === stageId)
  const stage = guide.stages[stageIndex]
  const text = level === 'hint' ? stage?.hintPreview : stage?.revealPreview
  if (!['math-route', 'learning-route'].includes(guide.presentation ?? '') || !Number.isInteger(guide.revision) || stageIndex < 0 || !text?.trim()) throw new Error('У этого этапа нет подготовленного текста помощи.')
  const latest = await getDocFromServer(doc(db, 'dayTaskGuides', studentToken, 'items', taskId))
  const current = latest.data()?.guide as ParentTaskGuide | undefined
  const freshStage = current?.stages?.[stageIndex]
  const freshText = level === 'hint' ? freshStage?.hintPreview : freshStage?.revealPreview
  const freshContent = level === 'reveal' && freshStage ? projectGuidanceReveal(freshStage) : undefined
  if (!latest.exists() || !current || current.revision !== guide.revision || freshStage?.id !== stageId
    || freshText !== text || (level === 'reveal' && JSON.stringify(freshContent) !== JSON.stringify(projectGuidanceReveal(stage!)))) {
    throw new Error('Разбор изменился. Откройте свежую версию карточки.')
  }
  const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
  const { familyId, childId, targetDate: date } = owner.data() ?? {}
  if (!owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string' || typeof date !== 'string') throw new Error('Семейная связь задания не найдена.')
  const members = await getDocs(collection(db, 'families', familyId, 'members'))
  const learners = members.docs.filter((member) => member.data().active === true && member.data().role === 'student' && member.data().childIds?.includes(childId))
  if (!learners.length) throw new Error('Личный вход ребёнка не найден.')
  const eventId = await guidanceEventId(studentToken, taskId, stage, level)
  const batch = writeBatch(db)
  const actorPersonId = currentEducationPersonId()
  const uid = getAuth().currentUser?.uid
  if (!uid) throw new Error('Сначала откройте личную ссылку Education.')
  const envelope = await prepareEducationEvent({
    eventType: 'parent.guidance_sent', familyId, childId, source: 'firestore',
    sourceRef: { kind: 'guidance', documentPath: `dayGuidance/${studentToken}/items/${eventId}`, dayToken: studentToken, taskId },
    operationId: eventId, actor: { type: 'user', uid },
  })
  batch.set(doc(db, 'dayGuidance', studentToken, 'items', eventId), {
    taskId, stageId, stageIndex, level, text, ...(level === 'reveal' ? { revealContent: freshContent } : {}), guideRevision: guide.revision, actorPersonId, createdAt: serverTimestamp(),
    eventOperationId: eventId, eventReceiptId: envelope.eventId, eventProducerVersion: 1,
  })
  for (const learner of learners) batch.set(doc(db, 'users', learner.id, 'inbox', eventId), {
    familyId, childId, type: 'parent_guidance', entityId: taskId, taskId, studentToken, eventId, date,
    sourceRevision: 1, createdAt: serverTimestamp(),
  })
  stagePreparedEducationEvent(batch, envelope)
  await batch.commit()
}
