/** @see ../../docs/modules/synchronization/event-queue.md */
import { doc, serverTimestamp, type WriteBatch, type Transaction } from 'firebase/firestore'
import { createEducationEvent } from '../../packages/education-events/envelope.mjs'
import type { EducationEventIdentity } from '../../packages/education-events/envelope.mjs'
import { db } from './firebase'

export type EducationEventInput = EducationEventIdentity & {
  actor: { type: 'user'; uid: string } | { type: 'system'; id: string }
}

export async function prepareEducationEvent(input: EducationEventInput) {
  return createEducationEvent(input, serverTimestamp())
}

export function stagePreparedEducationEvent(batch: WriteBatch, envelope: Awaited<ReturnType<typeof prepareEducationEvent>>) {
  batch.set(doc(db, 'educationEvents', envelope.eventId), envelope)
  return envelope.eventId
}

export function stagePreparedEducationEventInTransaction(transaction: Transaction, envelope: Awaited<ReturnType<typeof prepareEducationEvent>>) {
  transaction.set(doc(db, 'educationEvents', envelope.eventId), envelope)
  return envelope.eventId
}

export async function appendEducationEventToBatch(batch: WriteBatch, input: EducationEventInput): Promise<string> {
  return stagePreparedEducationEvent(batch, await prepareEducationEvent(input))
}

export async function appendEducationEventToTransaction(transaction: Transaction, input: EducationEventInput): Promise<string> {
  return stagePreparedEducationEventInTransaction(transaction, await prepareEducationEvent(input))
}
