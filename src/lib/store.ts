import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Answer, AnswerKey, Assignment, ManualReview, QuizQuestion, QuizReading, QuizVisual } from './quiz'

export type BoardDetails = {
  materials: string[]
  review: string
  purpose: string
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

export function watchAssignment(token: string, onChange: (assignment: Assignment) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'assignments', token), (snapshot) => {
    if (!snapshot.exists()) { onError(new Error('Ссылка не найдена или была отозвана.')); return }
    onChange(snapshot.data() as Assignment)
  }, onError)
}

export async function saveDraft(token: string, changedAnswers: Record<string, Answer>) {
  const reference = doc(db, 'assignments', token)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists() || snapshot.data().status !== 'open') return
    transaction.update(reference, {
      answers: { ...(snapshot.data().answers ?? {}), ...changedAnswers },
      status: 'open',
      ...(snapshot.data().startedAt == null ? { startedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
      submittedAt: null,
    })
  })
}

export async function submitAssignment(token: string) {
  const reference = doc(db, 'assignments', token)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('Ссылка не найдена.')
    const current = snapshot.data() as Assignment
    if (current.status !== 'open') throw new Error('Этот тест уже отправлен.')
    transaction.update(reference, {
      status: 'submitted',
      startedAt: current.startedAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
      submittedAt: serverTimestamp(),
    })
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
    title: String(item.data().title ?? 'Без названия'),
    description: String(item.data().description ?? ''),
    board: readBoardDetails(item.data().board),
    subject: String(item.data().subject ?? ''),
    slug: String(item.data().slug ?? ''),
    previewToken: String(item.data().previewToken ?? ''),
    createdAt: item.data().createdAt,
    position: typeof item.data().position === 'number' ? item.data().position as number : null,
  }))
}

export function watchDashboard(token: string, onChange: (items: Awaited<ReturnType<typeof loadDashboard>>) => void, onError: (error: Error) => void) {
  return onSnapshot(collection(db, 'dashboard', token, 'assignments'), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({
      token: item.id,
      title: String(item.data().title ?? 'Без названия'),
      description: String(item.data().description ?? ''),
      board: readBoardDetails(item.data().board),
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
