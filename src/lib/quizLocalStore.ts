import type { Answer, Assignment } from './quiz'

/** First IndexedDB slice of the local-first migration. This stores only the
 * pupil's assignment and unconfirmed answers, never answer keys or parent
 * guides. The existing localStorage copy remains readable by older clients.
 * @see ../../docs/services/web-app/local-first-sync.md#rollout */
const databaseName = 'education-local-v1'
const draftStore = 'quizDrafts'
const assignmentStore = 'quizAssignments'
type LocalRecord<T> = { token: string; value: T; updatedAt: number }
const pending = new Map<string, Promise<void>>()

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(draftStore)) database.createObjectStore(draftStore, { keyPath: 'token' })
      if (!database.objectStoreNames.contains(assignmentStore)) database.createObjectStore(assignmentStore, { keyPath: 'token' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Локальное хранилище тестов занято другой вкладкой.'))
  })
}

async function operation<T>(storeName: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = work(transaction.objectStore(storeName))
    let result: T
    request.onsuccess = () => { result = request.result }
    transaction.oncomplete = () => { database.close(); resolve(result) }
    transaction.onerror = () => { database.close(); reject(transaction.error) }
    transaction.onabort = () => { database.close(); reject(transaction.error) }
  })
}

function serialize(token: string, write: () => Promise<void>): Promise<void> {
  const next = (pending.get(token) ?? Promise.resolve()).catch(() => {}).then(write)
  pending.set(token, next)
  void next.finally(() => { if (pending.get(token) === next) pending.delete(token) }).catch(() => {})
  return next
}

export async function readLocalQuiz(token: string): Promise<{ assignment: Assignment | null; draft: Record<string, Answer> }> {
  await pending.get(token)?.catch(() => {})
  const [assignment, draft] = await Promise.all([
    operation<LocalRecord<Assignment> | undefined>(assignmentStore, 'readonly', (store) => store.get(token)),
    operation<LocalRecord<Record<string, Answer>> | undefined>(draftStore, 'readonly', (store) => store.get(token)),
  ])
  const validAssignment = assignment?.value?.schemaVersion === 1 && Array.isArray(assignment.value.questions) ? assignment.value : null
  const validDraft = draft?.value && typeof draft.value === 'object' && !Array.isArray(draft.value)
    ? Object.fromEntries(Object.entries(draft.value).filter((entry): entry is [string, Answer] =>
      typeof entry[1] === 'string' || Array.isArray(entry[1]) && entry[1].every((part) => typeof part === 'string')))
    : {}
  return { assignment: validAssignment, draft: validDraft }
}

export function writeLocalQuizDraft(token: string, answers: Record<string, Answer>): Promise<void> {
  const copy = { ...answers }
  return serialize(token, async () => {
    await operation(draftStore, 'readwrite', (store) => store.put({ token, value: copy, updatedAt: Date.now() } satisfies LocalRecord<Record<string, Answer>>))
  })
}

export function writeLocalQuizAssignment(token: string, assignment: Assignment): Promise<void> {
  return serialize(token, async () => {
    await operation(assignmentStore, 'readwrite', (store) => store.put({ token, value: assignment, updatedAt: Date.now() } satisfies LocalRecord<Assignment>))
  })
}
