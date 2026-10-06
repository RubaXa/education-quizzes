import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Answer, AnswerKey, Assignment, ManualReview, QuizQuestion } from './quiz'

export async function loadAssignment(token: string): Promise<Assignment> {
  const snapshot = await getDoc(doc(db, 'assignments', token))
  if (!snapshot.exists()) throw new Error('Ссылка не найдена или была отозвана.')
  return snapshot.data() as Assignment
}

export async function saveDraft(token: string, answers: Record<string, Answer>) {
  const reference = doc(db, 'assignments', token)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists() || snapshot.data().status !== 'open') return
    transaction.update(reference, {
      answers,
      status: 'open',
      ...(snapshot.data().startedAt == null ? { startedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
      submittedAt: null,
    })
  })
}

export async function submitAssignment(token: string, answers: Record<string, Answer>) {
  const reference = doc(db, 'assignments', token)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('Ссылка не найдена.')
    const current = snapshot.data() as Assignment
    if (current.status !== 'open') throw new Error('Этот тест уже отправлен.')
    transaction.update(reference, {
      answers,
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

export async function loadReview(token: string): Promise<ManualReview | undefined> {
  const snapshot = await getDoc(doc(db, 'reviews', token))
  return snapshot.exists() ? snapshot.data() as ManualReview : undefined
}

export async function loadPreview(token: string): Promise<{
  title: string
  description?: string
  subject: string
  questions: QuizQuestion[]
}> {
  const snapshot = await getDoc(doc(db, 'previews', token))
  if (!snapshot.exists()) throw new Error('Ссылка предпросмотра не найдена.')
  return snapshot.data() as {
    title: string
    description?: string
    subject: string
    questions: QuizQuestion[]
  }
}

export async function loadDashboard(token: string) {
  const snapshot = await getDocs(collection(db, 'dashboard', token, 'assignments'))
  return snapshot.docs.map((item) => ({
    token: item.id,
    title: String(item.data().title ?? 'Без названия'),
    subject: String(item.data().subject ?? ''),
    slug: String(item.data().slug ?? ''),
    previewToken: String(item.data().previewToken ?? ''),
    createdAt: item.data().createdAt,
  }))
}
