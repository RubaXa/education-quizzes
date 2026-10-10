import { collection, deleteField, doc, getDoc, getDocFromServer, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

export type DayInstruction = string | { text: string; source: { kind: 'mesh' | 'textbook' | 'review' | 'teacher-file'; label: string; evidence: string; excerpt?: string; ref?: string; certainty: 'confirmed' | 'uncertain' } }
export type DaySubmission = { buttonLabel: string; lead?: string; items?: DayInstruction[]; photo?: string; description?: string }
export type DaySourceCrop = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number; sourceSha256: string }
/** @see ../../docs/product/adaptive-problem-card.md#слои */
export type DayProblem = {
  id: string; number: number; title: string; detail: string; source: string;
  original?: { text: string; attachmentRef: string; crop?: DaySourceCrop };
  support?: { skill: string; state: 'unknown' | 'provisional' | 'practicing' | 'demonstrated'; evidence: string; evidenceRefs: string[]; facts: { label: string; value: string }[]; find: string; firstQuestion: string; revision: number };
}
export type DayTask = { id: string; title: string; detail: string; steps?: DayInstruction[]; problems?: DayProblem[]; status: 'verified' | 'needs-fix' | 'partial' | 'unknown'; kind: 'written' | 'read' | 'check'; source: string; submission?: DaySubmission | null; instructionStatus?: { state: 'needs-review' | 'reviewed'; message: string }; testToken?: string; testSlug?: string; requiredPoints?: number; originDate?: string; platformResult?: { state: 'completed'; points: number; maxPoints: number; durationMinutes?: number; observedDate?: string; source: string }; materialStatus?: { state: 'textbook-page-needed' | 'textbook-page-linked' | 'text-absent-from-textbook' | 'no-textbook'; message: string } }
export type DayMaterialLink = { title: string; url: string; sourceType: 'textbook-page' | 'teacher-attachment' | 'external-text'; reason?: string; sourceRef?: string; pdfPage?: number; printedPage?: number; editionStatus?: string; extraction?: string; sourceSha256?: string; sourceQuote?: string }
export type DaySubject = { id: string; name: string; icon: string; materials: string; mesh: string; summary: string; tasks: DayTask[] }
export type DayTestPlacement = { token: string; subjectId: string; taskId?: string; originDate?: string }
/** @see ../../docs/product/access-and-state.md#state */
export type DayPageData = {
  kind: 'student' | 'parent'; date: string; targetDate: string; meshFetchedAt: string;
  subjects: DaySubject[]; notices: string[]; gradeSummary: { id: string; name: string; average: number; allFives?: boolean; watch?: boolean }[]; gradeAsOf?: string;
  todaySchedule: { subject: string; start: string; end: string; homework: string }[];
  targetSchedule: { subject: string; start: string; end: string; homework: string }[];
  boardToken: string; studentToken?: string; parentNotes?: string[]; testPlacements?: DayTestPlacement[];
  materialLinks?: Record<string, DayMaterialLink[]>;
  taskPageRefs?: Record<string, string[]>;
  evidenceDayTokens?: string[]; planRevision?: number;
  changes?: { at: unknown; added: string[]; changed: string[]; changedSubjects?: string[]; newLinks: boolean; changedSchedule?: boolean }[];
  grades?: { id: string; name: string; grades: { mark: number; weight: number }[]; displayed_average: number; scenario_verified?: boolean }[];
  workingThreshold?: number;
}
/** @see ../../docs/product/storage-privacy.md#upload-queue */
export type DayUpload = { id: string; taskId: string; dataUrl?: string; originalName?: string; status: 'pending' | 'reviewed'; createdAt?: unknown; origin?: 'archive'; recordedDate?: string; storage?: { provider: 'yandex-disk'; state: 'stored'; path: string; size: number; md5?: string; syncedAt: unknown; publicUrl?: string } }
export type DayHelp = { id: string; taskId: string; revision: number; requestedAt?: unknown }
export type DayWorkReview = {
  id: string; taskId: string; status?: 'verified' | 'needs-fix' | 'partial' | 'cannot-assess';
  summary?: string; nextStep?: string; source?: string; checkedAt?: unknown; uploadIds?: string[];
  /** Separate the numeric result from the reasoning visible in a mathematical solution photo. */
  mathReasoning?: { answer: 'correct' | 'incorrect' | 'uncertain'; argument: 'sufficient' | 'incomplete' | 'not-shown' | 'unreadable' | 'not-required'; observed: string; minimumNeeded?: string; criterionSource?: string };
  items?: { label: string; status: 'correct' | 'incorrect' | 'partial' | 'cannot-assess'; observed: string; expected?: string; note: string }[];
  processing?: { phase: 'download' | 'source' | 'review' | 'publish' | 'paused'; label: string; reason?: string; uploadIds: string[]; startedAt: unknown; updatedAt: unknown };
  history?: Pick<DayWorkReview, 'status' | 'summary' | 'nextStep' | 'checkedAt' | 'items' | 'uploadIds' | 'mathReasoning'>[];
}

export async function loadDayPage(token: string): Promise<DayPageData> {
  const snapshot = await getDoc(doc(db, 'dayPages', token))
  if (!snapshot.exists()) throw new Error('Страница дня не найдена.')
  if (snapshot.data().schemaVersion !== 1) throw new Error('Данные дня обновились. Обновите приложение до новой версии.')
  return snapshot.data() as DayPageData
}
export function watchDayPage(token: string, onChange: (page: DayPageData) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'dayPages', token), (snapshot) => {
    if (!snapshot.exists()) { onError(new Error('Страница дня не найдена.')); return }
    if (snapshot.data().schemaVersion !== 1) { onError(new Error('Данные дня обновились. Обновите приложение до новой версии.')); return }
    onChange(snapshot.data() as DayPageData)
  }, onError)
}
/** @see ../../docs/product/materials.md#firestore-catalog */
export function watchMaterialPages(refs: string[], onChange: (pages: Record<string, DayMaterialLink>) => void, onError: (error: Error) => void) {
  const unique = [...new Set(refs)]
  const pages: Record<string, DayMaterialLink> = {}
  const stops = unique.map((ref) => {
    const match = /^([a-z0-9-]+)#([1-9]\d*)$/.exec(ref)
    if (!match) { onError(new Error(`Неизвестная страница учебника: ${ref}`)); return () => {} }
    return onSnapshot(doc(db, 'materialBooks', match[1], 'pages', match[2]), (snapshot) => {
      const data = snapshot.data()
      if (data?.state === 'published' && typeof data.url === 'string' && data.url.startsWith('https://')) {
        pages[ref] = { title: data.title || `${data.subject || 'Учебник'}, стр. ${data.printedPage}`,
          url: data.url, sourceType: 'textbook-page', sourceRef: data.sourceRef,
          pdfPage: data.pdfPage, printedPage: data.printedPage, editionStatus: data.editionStatus,
          extraction: data.extraction, sourceSha256: data.sourceSha256 }
      } else delete pages[ref]
      onChange({ ...pages })
    }, onError)
  })
  return () => stops.forEach((stop) => stop())
}
/** @see ../../docs/product/access-and-state.md#state */
export function watchDayUploads(tokens: string[], onChange: (data: DayUpload[]) => void, onError: (error: Error) => void) {
  const parts = new Map<string, DayUpload[]>()
  const unique = [...new Set(tokens)]
  const stops = unique.map((studentToken) => onSnapshot(collection(db, 'dayUploads', studentToken, 'files'), (snapshot) => {
    parts.set(studentToken, snapshot.docs.filter((item) => item.data().status !== 'deleted').map((item) => ({ id: `${studentToken}:${item.id}`, ...item.data() } as DayUpload)))
    onChange(unique.flatMap((token) => parts.get(token) || []))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
/** @see ../../docs/product/day-page.md#homework-review */
export function watchDayReviews(tokens: string[], onChange: (data: DayWorkReview[]) => void, onError: (error: Error) => void) {
  const parts = new Map<string, DayWorkReview[]>()
  const unique = [...new Set(tokens)]
  const stops = unique.map((studentToken) => onSnapshot(collection(db, 'dayProgress', studentToken, 'items'), (snapshot) => {
    parts.set(studentToken, snapshot.docs.map((item) => ({ id: `${studentToken}:${item.id}`, ...item.data() } as DayWorkReview)))
    onChange(unique.flatMap((token) => parts.get(token) || []))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
/** @see ../../docs/product/adaptive-problem-card.md#показ-ученику */
export function watchDayHelp(tokens: string[], onChange: (data: DayHelp[]) => void, onError: (error: Error) => void) {
  const parts = new Map<string, DayHelp[]>()
  const unique = [...new Set(tokens)]
  const stops = unique.map((studentToken) => onSnapshot(collection(db, 'dayHelp', studentToken, 'items'), (snapshot) => {
    parts.set(studentToken, snapshot.docs.map((item) => ({ id: `${studentToken}:${item.id}`, ...item.data() } as DayHelp)))
    onChange(unique.flatMap((token) => parts.get(token) || []))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
export async function requestDayHelp(studentToken: string, taskId: string, revision: number) {
  await setDoc(doc(db, 'dayHelp', studentToken, 'items', taskId), { taskId, revision, requestedAt: serverTimestamp() })
}
async function compressedImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите фотографию или изображение.')
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить фото.')
  for (const maxSide of [2000, 1700, 1400, 1100]) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.84, 0.73, 0.62]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= 700000) { bitmap.close(); return dataUrl }
    }
  }
  bitmap.close()
  throw new Error('Фото слишком велико. Сфотографируйте одну страницу ближе и повторите.')
}
/** @see ../../docs/product/storage-privacy.md#upload-queue */
export async function uploadDayPhoto(studentToken: string, taskId: string, file: File, uploadId: string = crypto.randomUUID()) {
  const dataUrl = await compressedImage(file)
  const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
  try {
    await setDoc(ref, { taskId, dataUrl, originalName: file.name.slice(0, 120), status: 'pending', createdAt: serverTimestamp() })
  } catch (cause) {
    // A lost acknowledgement must not turn Retry into another photo or overwrite
    // a record that the server has already accepted.
    try {
      const saved = await getDocFromServer(ref)
      if (saved.exists() && saved.data().taskId === taskId && saved.data().status === 'pending') return uploadId
    } catch { /* Keep the original upload error for the per-photo retry UI. */ }
    throw cause
  }
  return uploadId
}

/** @see ../../docs/product/storage-privacy.md#photo-deletion */
export async function removePendingDayPhoto(studentToken: string, uploadId: string) {
  const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
  const current = await getDocFromServer(ref)
  if (!current.exists() || current.data().status === 'deleted') return
  if (current.data().status !== 'pending') throw new Error('Проверенную работу удалить нельзя.')
  await updateDoc(ref, {
    status: 'deleted', deletedAt: serverTimestamp(), dataUrl: deleteField(), originalName: deleteField(),
  })
}
