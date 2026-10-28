import {
  collection,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from './firebase'
import { currentEducationPersonId } from './personalAccess'
import type { Answer, AnswerKey, Assignment, ManualReview, QuizQuestion, QuizReading, QuizVisual } from './quiz'
import { assertOpenAssignment } from './quizWrite'
import { prepareEducationEvent, stagePreparedEducationEventInTransaction } from './educationEventProducer'

/** Public placement metadata is descriptive and cannot grant access. */
export function readLearningContext(value: unknown): Assignment['learningContext'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  if (Object.keys(data).some(key => key !== 'kind' && key !== 'id') ||
    !['homework', 'course', 'olympiad'].includes(String(data.kind)) ||
    typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) return undefined
  return { kind: data.kind as 'homework' | 'course' | 'olympiad', id: data.id }
}

export type BoardDetails = {
  materials: string[]
  review: string
  purpose: string
}

function sourceRevisionId(value: unknown): string {
  if (!value || typeof value !== 'object') return 'initial'
  const timestamp = value as { seconds?: number; nanoseconds?: number; _seconds?: number; _nanoseconds?: number }
  const seconds = timestamp.seconds ?? timestamp._seconds
  const nanos = timestamp.nanoseconds ?? timestamp._nanoseconds
  return typeof seconds === 'number' && typeof nanos === 'number' ? `${seconds}-${nanos}` : 'initial'
}

function readBoardDetails(value: unknown): BoardDetails | null {
  if (!value || typeof value !== 'object') return null
  const board = value as Partial<BoardDetails>
  if (!Array.isArray(board.materials) || !board.materials.every((item) => typeof item === 'string')) return null
  if (typeof board.review !== 'string' || typeof board.purpose !== 'string') return null
  return { materials: board.materials, review: board.review, purpose: board.purpose }
}

export async function loadAssignment(token: string): Promise<Assignment> {
  const snapshot = await getDoc(doc(db, 'assignments', token))
  if (!snapshot.exists()) throw new Error('Ссылка не найдена или была отозвана.')
  return snapshot.data() as Assignment
}

/** @see ../../docs/modules/assessments/quizzes.md#followup-request */
export async function requestQuizFollowup(token: string, testId: string): Promise<void> {
  const reference = doc(db, 'assignments', token)
  const operationId = `quiz-followup:${token}`
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('Исходный тест не найден.')
    const current = snapshot.data() as Assignment & { familyId?: string; childId?: string }
    if (current.testId !== testId || current.status !== 'submitted') throw new Error('Результат теста изменился. Обновите страницу.')
    if (current.followupRequestedAt) return
    if (!current.familyId || !current.childId) throw new Error('Не найдена семейная привязка теста.')
    const uid = getAuth().currentUser?.uid
    if (!uid) throw new Error('Сначала откройте личную ссылку Education.')
    const envelope = await prepareEducationEvent({
      eventType: 'quiz.followup_requested', familyId: current.familyId, childId: current.childId, source: 'firestore',
      sourceRef: { kind: 'quiz', documentPath: `assignments/${token}`, quizToken: token },
      operationId, actor: { type: 'user', uid },
    })
    transaction.update(reference, { followupRequestedAt: serverTimestamp(), followupRequestedBy: currentEducationPersonId(), eventOperationId: operationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
    stagePreparedEducationEventInTransaction(transaction, envelope)
  })
}

/** Parent choice belongs to the root assignment, while the current open attempt
 * can be a later linked test. One or two document reads happen only on a click.
 * @see ../../docs/modules/assessments/quizzes.md#optional-quiz */
export async function setQuizRequired(rootToken: string, activeToken: string, required: boolean): Promise<void> {
  const rootRef = doc(db, 'assignments', rootToken)
  const activeRef = doc(db, 'assignments', activeToken)
  await runTransaction(db, async (transaction) => {
    const root = await transaction.get(rootRef)
    const active = activeToken === rootToken ? root : await transaction.get(activeRef)
    if (!root.exists() || !active.exists()) throw new Error('Тест больше не найден. Обновите страницу.')
    const origin = root.data() as Assignment & { familyId?: string; childId?: string }
    const current = active.data() as Assignment & { familyId?: string; childId?: string }
    if (origin.linkedToTestId || current.status !== 'open'
      || !origin.familyId || !origin.childId || origin.familyId !== current.familyId || origin.childId !== current.childId) {
      throw new Error('Активный тест изменился. Обновите страницу.')
    }
    if (Boolean(origin.familyOptional) === !required) return
    const operationId = `quiz-requirement:${rootToken}:${required ? 'required' : 'optional'}:${sourceRevisionId(origin.familyChoiceAt)}`
    const uid = getAuth().currentUser?.uid
    if (!uid) throw new Error('Сначала откройте личную ссылку Education.')
    const envelope = await prepareEducationEvent({
      eventType: 'quiz.requirement_changed', familyId: origin.familyId!, childId: origin.childId!, source: 'firestore',
      sourceRef: { kind: 'quiz', documentPath: `assignments/${rootToken}`, quizToken: rootToken },
      operationId, actor: { type: 'user', uid },
    })
    transaction.update(rootRef, { familyOptional: !required, familyChoiceAt: serverTimestamp(), familyChoiceBy: currentEducationPersonId(), eventOperationId: operationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
    stagePreparedEducationEventInTransaction(transaction, envelope)
  })
}

/** @see ../../docs/modules/assessments/quizzes.md#quiz-runner */
export function watchAssignment(token: string, onChange: (assignment: Assignment, confirmed: boolean) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'assignments', token), { includeMetadataChanges: true }, (snapshot) => {
    if (!snapshot.exists()) { onError(new Error('Ссылка не найдена или была отозвана.')); return }
    onChange(snapshot.data() as Assignment, !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites)
  }, onError)
}

/** @see ../../docs/modules/assessments/quizzes.md#quiz-runner */
export async function saveDraft(token: string, changedAnswers: Record<string, Answer>, started: boolean) {
  const reference = doc(db, 'assignments', token)
  if (started) {
    const fields: unknown[] = []
    for (const [id, answer] of Object.entries(changedAnswers)) fields.push(new FieldPath('answers', id), answer)
    if (!fields.length) return
    fields.push('updatedAt', serverTimestamp())
    // Update only changed answer fields. A read/merge transaction for every edit
    // consumed the daily Firestore read allowance during long written tests.
    await updateDoc(reference, fields[0] as FieldPath, fields[1], ...fields.slice(2))
    return
  }
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    const current = snapshot.exists() ? snapshot.data() : undefined
    assertOpenAssignment(current)
    const startsNow = current?.startedAt == null
    let startEnvelope: Awaited<ReturnType<typeof prepareEducationEvent>> | undefined
    let startOperationId: string | undefined
    if (startsNow) {
      const scoped = current as (Assignment & { familyId?: string; childId?: string }) | undefined
      if (!scoped?.familyId || !scoped.childId) throw new Error('Не найдена семейная привязка теста.')
      const uid = getAuth().currentUser?.uid
      if (!uid) throw new Error('Сначала откройте личную ссылку Education.')
      startOperationId = `quiz-start:${token}`
      startEnvelope = await prepareEducationEvent({
        eventType: 'quiz.started', familyId: scoped.familyId, childId: scoped.childId, source: 'firestore',
        sourceRef: { kind: 'quiz', documentPath: `assignments/${token}`, quizToken: token },
        operationId: startOperationId, actor: { type: 'user', uid },
      })
    }
    const update = {
      answers: { ...(current?.answers ?? {}), ...changedAnswers },
      status: 'open',
      ...(startsNow ? { startedAt: serverTimestamp(), eventOperationId: startOperationId!, eventReceiptId: startEnvelope!.eventId, eventProducerVersion: 1 } : {}),
      updatedAt: serverTimestamp(),
      submittedAt: null,
    }
    transaction.update(reference, update)
    if (startEnvelope) stagePreparedEducationEventInTransaction(transaction, startEnvelope)
  })
}

/** @see ../../docs/modules/assessments/quizzes.md#quiz-runner */
export async function submitAssignment(token: string) {
  const reference = doc(db, 'assignments', token)
  const operationId = `quiz-submit:${token}`
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('Ссылка не найдена.')
    const current = snapshot.data() as Assignment & { familyId?: string; childId?: string }
    if (current.status !== 'open') throw new Error('Этот тест уже отправлен.')
    if (!current.familyId || !current.childId) throw new Error('Не найдена семейная привязка теста.')
    const uid = getAuth().currentUser?.uid
    if (!uid) throw new Error('Сначала откройте личную ссылку Education.')
    const envelope = await prepareEducationEvent({
      eventType: 'quiz.submitted', familyId: current.familyId, childId: current.childId, source: 'firestore',
      sourceRef: { kind: 'quiz', documentPath: `assignments/${token}`, quizToken: token },
      operationId, actor: { type: 'user', uid },
    })
    transaction.update(reference, {
      status: 'submitted',
      startedAt: current.startedAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
      submittedAt: serverTimestamp(),
      eventReceiptId: envelope.eventId,
      eventOperationId: operationId,
      eventProducerVersion: 1,
    })
    stagePreparedEducationEventInTransaction(transaction, envelope)
  })
}

export async function loadAnswerKey(token: string): Promise<AnswerKey> {
  const snapshot = await getDoc(doc(db, 'answerKeys', token))
  if (!snapshot.exists()) throw new Error('Ключ ответов пока не опубликован.')
  return snapshot.data() as AnswerKey
}

export function watchAnswerKey(token: string, onChange: (key: AnswerKey) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'answerKeys', token), (snapshot) => {
    if (snapshot.exists()) onChange(snapshot.data() as AnswerKey)
  }, onError)
}

export async function loadReview(token: string): Promise<ManualReview | undefined> {
  const snapshot = await getDoc(doc(db, 'reviews', token))
  return snapshot.exists() ? snapshot.data() as ManualReview : undefined
}

/** @see ../../docs/modules/assessments/quizzes.md#quiz-results */
export function watchReview(token: string, onChange: (review: ManualReview | undefined) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'reviews', token), (snapshot) => {
    onChange(snapshot.exists() ? snapshot.data() as ManualReview : undefined)
  }, onError)
}

export async function loadPreview(token: string): Promise<{
  title: string
  description?: string
  subject: string
  visual?: QuizVisual
  reading?: QuizReading
  questions: QuizQuestion[]
}> {
  const snapshot = await getDoc(doc(db, 'previews', token))
  if (!snapshot.exists()) throw new Error('Ссылка предпросмотра не найдена.')
  return snapshot.data() as {
    title: string
    description?: string
    subject: string
    visual?: QuizVisual
    reading?: QuizReading
    questions: QuizQuestion[]
  }
}

export async function loadDashboard(token: string) {
  const snapshot = await getDocs(collection(db, 'dashboard', token, 'assignments'))
  return snapshot.docs.map((item) => ({
    token: item.id,
    testId: String(item.data().testId ?? ''),
    linkedToTestId: typeof item.data().linkedToTestId === 'string' ? item.data().linkedToTestId as string : null,
    title: String(item.data().title ?? 'Без названия'),
    description: String(item.data().description ?? ''),
    board: readBoardDetails(item.data().board),
    learningContext: readLearningContext(item.data().learningContext),
    subject: String(item.data().subject ?? ''),
    slug: String(item.data().slug ?? ''),
    previewToken: String(item.data().previewToken ?? ''),
    createdAt: item.data().createdAt,
    position: typeof item.data().position === 'number' ? item.data().position as number : null,
  }))
}

/** @see ../../docs/modules/assessments/quizzes.md#test-lists */
export function watchDashboard(token: string, onChange: (items: Awaited<ReturnType<typeof loadDashboard>>) => void, onError: (error: Error) => void) {
  return onSnapshot(collection(db, 'dashboard', token, 'assignments'), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({
      token: item.id,
      testId: String(item.data().testId ?? ''),
      linkedToTestId: typeof item.data().linkedToTestId === 'string' ? item.data().linkedToTestId as string : null,
      title: String(item.data().title ?? 'Без названия'),
      description: String(item.data().description ?? ''),
      board: readBoardDetails(item.data().board),
      learningContext: readLearningContext(item.data().learningContext),
      subject: String(item.data().subject ?? ''),
      slug: String(item.data().slug ?? ''),
      previewToken: String(item.data().previewToken ?? ''),
      createdAt: item.data().createdAt,
      position: typeof item.data().position === 'number' ? item.data().position as number : null,
    })))
  }, onError)
}

export function watchViewed(token: string, onChange: (ids: Set<string>) => void, onError: (error: Error) => void) {
  return onSnapshot(collection(db, 'dashboard', token, 'seen'), (snapshot) => {
    onChange(new Set(snapshot.docs.map((item) => item.id)))
  }, onError)
}

export async function markViewed(boardToken: string, assignmentToken: string) {
  await setDoc(doc(db, 'dashboard', boardToken, 'seen', assignmentToken), { seenAt: serverTimestamp() })
}
