import { collection, doc, getDocFromServer, getDocs, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { currentEducationPersonId } from './personalAccess'
import type { ParentTaskGuide } from './dayStore'

export type DayGuidance = {
  id: string; taskId: string; stageId: string; stageIndex: number; level: 'hint' | 'reveal';
  text: string; guideRevision: number; actorPersonId: string; createdAt: unknown;
}

/** Read-only on the learner route; the guide and neighboring stages remain private.
 * @see ../../docs/product/subject-aware-guidance.md#math-route */
export function watchDayGuidance(studentToken: string, onChange: (items: DayGuidance[]) => void, onError: (error: Error) => void) {
  return onSnapshot(collection(db, 'dayGuidance', studentToken, 'items'), (snapshot) => {
    onChange(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as DayGuidance))
      .sort((a, b) => ((a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0) - ((b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0) || a.id.localeCompare(b.id)))
  }, onError)
}

/** One immutable release per stage and prepared wording, shared by both help buttons. */
async function guidanceEventId(studentToken: string, taskId: string, stage: ParentTaskGuide['stages'][number]) {
  const source = JSON.stringify([studentToken, taskId, stage.id, stage.hintPreview ?? '', stage.revealPreview ?? ''])
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
  if (!latest.exists() || !current || current.revision !== guide.revision || current.stages[stageIndex]?.id !== stageId
    || (level === 'hint' ? current.stages[stageIndex].hintPreview : current.stages[stageIndex].revealPreview) !== text) {
    throw new Error('Разбор изменился. Откройте свежую версию карточки.')
  }
  const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
  const { familyId, childId, targetDate: date } = owner.data() ?? {}
  if (!owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string' || typeof date !== 'string') throw new Error('Семейная связь задания не найдена.')
  const members = await getDocs(collection(db, 'families', familyId, 'members'))
  const learners = members.docs.filter((member) => member.data().active === true && member.data().role === 'student' && member.data().childIds?.includes(childId))
  if (!learners.length) throw new Error('Личный вход ребёнка не найден.')
  const eventId = await guidanceEventId(studentToken, taskId, stage)
  const batch = writeBatch(db)
  const actorPersonId = currentEducationPersonId()
  batch.set(doc(db, 'dayGuidance', studentToken, 'items', eventId), {
    taskId, stageId, stageIndex, level, text, guideRevision: guide.revision, actorPersonId, createdAt: serverTimestamp(),
  })
  for (const learner of learners) batch.set(doc(db, 'users', learner.id, 'inbox', eventId), {
    familyId, childId, type: 'parent_guidance', entityId: taskId, taskId, studentToken, eventId, date,
    sourceRevision: 1, createdAt: serverTimestamp(),
  })
  await batch.commit()
}
