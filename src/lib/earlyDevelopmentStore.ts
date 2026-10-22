/** @see ../../docs/modules/families/early-development.md */
import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { currentEducationPersonId, type PersonalChild } from './personalAccess'
import type { EarlyProgram } from '../../early-development/program.mjs'
import type { Observation } from './earlyDevelopment'

export type EarlyPlan = { schemaVersion: 1; birthDate: string; timezone: string; programVersion: string; curriculum: EarlyProgram }
const childPath = (child: PersonalChild) => ['families', child.familyId, 'children', child.childId] as const
export function watchEarlyPlan(child: PersonalChild, next: (plan: EarlyPlan) => void, fail: (error: Error) => void) {
  return onSnapshot(doc(db, ...childPath(child), 'earlyDevelopment', 'current'), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return
    const data = snapshot.data() as EarlyPlan | undefined
    if (!data || data.schemaVersion !== 1 || data.programVersion !== data.curriculum?.version || !data.curriculum.stages?.length) { fail(new Error('Программа пока не опубликована.')); return }
    next(data)
  }, fail)
}
export function watchEarlyJournal(child: PersonalChild, count: number, next: (entries: Observation[]) => void, fail: (error: Error) => void) {
  return onSnapshot(query(collection(db, ...childPath(child), 'earlyObservations'), orderBy('observedAt', 'desc'), limit(count)), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return
    next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id, observedAt: item.data().observedAt.toDate().toISOString(), updatedAt: item.data().revision > 1 ? item.data().updatedAt.toDate().toISOString() : undefined }) as Observation))
  }, fail)
}
/** Optimistic concurrency + immutable audit revision in the same transaction. */
export async function saveEarlyObservation(child: PersonalChild, value: Observation, previous?: Observation) {
  const personId = currentEducationPersonId()
  const ref = doc(db, ...childPath(child), 'earlyObservations', value.id)
  const revisionId = crypto.randomUUID()
  await runTransaction(db, async (tx) => {
    const current = await tx.get(ref)
    if (previous ? !current.exists() || current.data().revision !== previous.revision : current.exists()) {
      throw new Error('Запись уже изменена на другом устройстве. Откройте её заново; ваш текст остаётся в форме.')
    }
    const prior = current.data()
    const data = {
      schemaVersion: 1, activityId: value.activityId, activityTitle: value.activityTitle ?? value.activityId,
      programVersion: value.programVersion, observedAt: Timestamp.fromDate(new Date(value.observedAt)), reaction: value.reaction, note: value.note,
      deleted: value.deleted === true, authorId: prior?.authorId ?? personId, createdAt: prior?.createdAt ?? serverTimestamp(),
      updatedBy: personId, updatedAt: serverTimestamp(), revision: (prior?.revision ?? 0) + 1, revisionId,
    }
    tx.set(ref, data)
    tx.set(doc(ref, 'history', revisionId), data)
  })
}
