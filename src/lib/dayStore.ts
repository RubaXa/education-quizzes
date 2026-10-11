import { collection, doc, getDoc, getDocFromServer, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from './firebase'
import { removePhotoFromOutbox, resumePhotoTransfer, savePhotoForTransfer } from './photoOutbox'

export type DayInstruction = string | { text: string; source: { kind: 'mesh' | 'textbook' | 'review' | 'teacher-file'; label: string; evidence: string; excerpt?: string; ref?: string; certainty: 'confirmed' | 'uncertain' } }
export type DaySubmission = { buttonLabel: string; lead?: string; items?: DayInstruction[]; photo?: string; description?: string }
export type DaySourceCrop = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number; sourceSha256: string }
/** @see ../../docs/product/adaptive-problem-card.md#слои */
export type DayProblem = {
  id: string; number: number; title: string; detail: string; source: string;
  original?: { text: string; attachmentRef: string; crop?: DaySourceCrop };
  support?: { skill: string; state: 'unknown' | 'provisional' | 'practicing' | 'demonstrated'; evidence: string; evidenceRefs: string[]; facts: { label: string; value: string }[]; find: string; firstQuestion: string; revision: number };
  /** Parent document only. Never include answer keys or solution steps in a day page. */
  sourceResearch?: { status: 'candidate' | 'verified' | 'not-found' | 'conflict'; title: string; url?: string; match: string; keyStatus: 'not-checked' | 'candidate' | 'verified' | 'unavailable'; note?: string };
}
export type DayTask = { id: string; title: string; detail: string; meshText?: string; steps?: DayInstruction[]; problems?: DayProblem[]; status: 'verified' | 'needs-fix' | 'partial' | 'unknown'; kind: 'written' | 'read' | 'check'; source: string; submission?: DaySubmission | null; instructionStatus?: { state: 'needs-review' | 'reviewed'; message: string }; testToken?: string; testSlug?: string; requiredPoints?: number; originDate?: string; lessonDate?: string; dueDate?: string; dueDateEvidence?: { kind: 'mesh'; excerpt: string }; platformResult?: { state: 'completed'; points: number; maxPoints: number; durationMinutes?: number; observedDate?: string; source: string }; materialStatus?: { state: 'textbook-page-needed' | 'textbook-page-linked' | 'text-absent-from-textbook' | 'no-textbook'; message: string } }
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
  /** Raw MESH entries that point to material already attached to another task. @see ../../docs/product/plan-generation.md#material-only-mesh-entries */
  sourceOnlyEntries?: { id: string; subjectId: string; targetTaskId: string; rawText: string; reason: string }[];
  retiredTaskIds?: string[];
  weekendSlot?: { dates: string[]; title: string; taskIds: string[]; dueDate?: string } | null;
  evidenceDayTokens?: string[]; planRevision?: number;
  changes?: { at: unknown; added: string[]; removed?: string[]; changed: string[]; changedSubjects?: string[]; newLinks: boolean; changedSchedule?: boolean; changedWeekendSlot?: boolean }[];
  grades?: { id: string; name: string; grades: { mark: number; weight: number }[]; displayed_average: number; scenario_verified?: boolean }[];
  workingThreshold?: number;
}
/** @see ../../docs/product/storage-privacy.md#upload-queue */
export type DayUpload = { id: string; taskId: string; coveredTaskIds?: string[]; processingTaskIds?: string[]; coverageNote?: string; dataUrl?: string; originalName?: string; status: 'requested' | 'awaiting-upload' | 'uploaded' | 'upload-error' | 'pending' | 'reviewed'; error?: string; createdAt?: unknown; origin?: 'archive'; recordedDate?: string; upload?: { href: string }; storage?: { provider: 'yandex-disk'; state: 'stored'; path: string; size: number; md5?: string; sha256?: string; syncedAt: unknown; publicUrl?: string } }
/** Upload placement is a UI entry point; confirmed coverage can include other tasks. @see ../../docs/product/storage-privacy.md#multi-task-photo */
export function uploadMatchesTask(upload: DayUpload, taskId: string) {
  return upload.coveredTaskIds ? upload.coveredTaskIds.includes(taskId)
    : upload.processingTaskIds ? upload.processingTaskIds.includes(taskId) : upload.taskId === taskId
}
export type DayHelp = { id: string; taskId: string; revision: number; requestedAt?: unknown; requestKind?: 'condition' | 'start' | 'step' | 'check'; requestText?: string }
export type DayWorkReview = {
  id: string; taskId: string; status?: 'verified' | 'needs-fix' | 'partial' | 'cannot-assess';
  summary?: string; nextStep?: string; source?: string; checkedAt?: unknown; uploadIds?: string[];
  /** @see ../../docs/product/review-criteria-provenance.md */
  assessmentBasis?: {
    grade?: number; schoolYear?: string; requirement?: string; observed?: string; comparison?: string;
    outcome: 'met' | 'not-met' | 'unresolved'; limitation?: string;
    sources?: { kind: 'teacher' | 'mesh' | 'textbook' | 'method-guide' | 'curriculum' | 'official-key'; ref: string; excerpt: string; role: 'requirement' | 'context' }[];
    disputedRequirementIds?: string[];
    /** A proposed family action is not a teacher requirement. @see ../../docs/product/review-criteria-provenance.md#family-disputes */
    disputedRequirements?: { id: string; action: string; meshExcerpt?: string; sourceKind?: 'textbook' | 'model-inference'; sourceExcerpt?: string; sourceRef?: string; uncertainty?: string }[];
  };
  /** Operator-reviewed text safe for the student view; never generated from the private answer key in the client. */
  studentFeedback?: { title: string; confirmed: string; focus: string; question: string; anchor?: { uploadId: string; location: string } };
  /** Separate the numeric result from the reasoning visible in a mathematical solution photo. */
  mathReasoning?: { answer: 'correct' | 'incorrect' | 'uncertain'; argument: 'sufficient' | 'incomplete' | 'not-shown' | 'unreadable' | 'not-required'; observed?: string; minimumNeeded?: string; criterionSource?: string };
  /** Whether every assigned action is visibly present; independent of the teacher's quality criterion. @see ../../docs/product/review-criteria-provenance.md#work-coverage */
  workCoverage?: { state: 'complete' | 'incomplete' | 'unknown'; note: string; sourceRef: string; reviewCheckedAt: unknown; recordedAt: unknown };
  items?: { label: string; status: 'correct' | 'incorrect' | 'partial' | 'cannot-assess'; observed?: string; expected?: string; note?: string }[];
  processing?: { phase: 'download' | 'source' | 'review' | 'publish' | 'paused'; label: string; reason?: string; uploadIds: string[]; startedAt: unknown; updatedAt: unknown };
  history?: Pick<DayWorkReview, 'status' | 'summary' | 'nextStep' | 'checkedAt' | 'items' | 'uploadIds' | 'mathReasoning' | 'studentFeedback' | 'assessmentBasis'>[];
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
/** @see ../../docs/product/plan-generation.md#cross-day-results */
export function watchEvidenceDayPages(tokens: string[], onChange: (pages: DayPageData[]) => void, onError: (error: Error) => void) {
  const parts = new Map<string, DayPageData>()
  const unique = [...new Set(tokens)]
  const stops = unique.map((token) => watchDayPage(token, (page) => {
    if (page.kind === 'student') parts.set(token, page)
    if (parts.size === unique.length) onChange(unique.map((item) => parts.get(item)!))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
/** A completed platform result belongs to an assignment, even when it was published on an earlier day page. */
export function withVerifiedPlatformResult(task: DayTask, targetDate: string, pages: DayPageData[]): DayTask {
  if (task.kind !== 'check' || !task.id.endsWith('-cdz') || task.platformResult?.state === 'completed') return task
  const candidates = pages.filter((page) => page.targetDate === targetDate)
    .flatMap((page) => page.subjects.flatMap((subject) => subject.tasks))
    .filter((prior) => prior.id === task.id && prior.meshText === task.meshText && prior.platformResult?.state === 'completed')
    .sort((a, b) => (b.platformResult?.observedDate ?? '').localeCompare(a.platformResult?.observedDate ?? ''))
  if (!candidates.length || candidates.length > 1 && candidates[0].platformResult?.observedDate === candidates[1].platformResult?.observedDate
    && JSON.stringify(candidates[0].platformResult) !== JSON.stringify(candidates[1].platformResult)) return task
  return { ...task, status: 'verified', platformResult: candidates[0].platformResult }
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
    parts.set(studentToken, snapshot.docs.filter((item) => item.data().status !== 'deleted').map((item) => {
      const data = item.data()
      resumePhotoTransfer(studentToken, item.id, data as { status: string; upload?: { href: string }; deviceUid?: string })
      return { id: `${studentToken}:${item.id}`, ...data } as DayUpload
    }))
    onChange(unique.flatMap((token) => parts.get(token) || []))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
/** @see ../../docs/product/day-page.md#homework-review */
export function watchDayReviews(tokens: string[], onChange: (data: DayWorkReview[]) => void, onError: (error: Error) => void, parent = false) {
  const parts = new Map<string, DayWorkReview[]>()
  const privateParts = new Map<string, DayWorkReview[]>()
  const unique = [...new Set(tokens)]
  const emit = () => onChange(unique.flatMap((token) => {
    const publicItems = parts.get(token) || []
    if (!parent) return publicItems
    const privateById = new Map((privateParts.get(token) || []).map((item) => [item.id, item]))
    return publicItems.map((item) => ({ ...item, ...privateById.get(item.id), processing: item.processing }))
  }))
  const stops = unique.map((studentToken) => onSnapshot(collection(db, 'dayProgress', studentToken, 'items'), (snapshot) => {
    parts.set(studentToken, snapshot.docs.map((item) => ({ id: `${studentToken}:${item.id}`, ...item.data() } as DayWorkReview)))
    emit()
  }, onError))
  if (parent) stops.push(...unique.map((studentToken) => onSnapshot(collection(db, 'dayReviewPrivate', studentToken, 'items'), (snapshot) => {
    privateParts.set(studentToken, snapshot.docs.map((item) => ({ id: `${studentToken}:${item.id}`, ...item.data() } as DayWorkReview)))
    emit()
  }, onError)))
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
export async function requestDayHelp(studentToken: string, taskId: string, revision: number, requestKind: NonNullable<DayHelp['requestKind']>, requestText: string) {
  await setDoc(doc(db, 'dayHelp', studentToken, 'items', taskId), { taskId, revision, requestKind, requestText: requestText.trim().slice(0, 800), requestedAt: serverTimestamp() })
}
const photoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
/** @see ../../docs/product/storage-privacy.md#upload-queue */
export async function uploadDayPhoto(studentToken: string, taskId: string, file: File, uploadId: string = crypto.randomUUID(), planRevision?: number) {
  if (!photoTypes.has(file.type) || !file.size || file.size > 25_000_000) throw new Error('Выберите фото JPEG, PNG, WebP или HEIC размером до 25 МБ.')
  const deviceUid = getAuth().currentUser?.uid
  if (!deviceUid) throw new Error('Сначала откройте личную ссылку Education.')
  const revision = planRevision ?? (await getDocFromServer(doc(db, 'dayPages', studentToken))).data()?.planRevision
  if (!Number.isInteger(revision)) throw new Error('Не найдена текущая версия задания. Обновите страницу.')
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
  await savePhotoForTransfer(studentToken, uploadId, file)
  const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
  try {
    await setDoc(ref, { taskId, planRevision: revision, deviceUid, contentType: file.type, size: file.size, sha256,
      status: 'requested', createdAt: serverTimestamp() })
  } catch (cause) {
    try {
      const saved = await getDocFromServer(ref)
      if (saved.exists() && saved.data().taskId === taskId && saved.data().sha256 === sha256) return uploadId
    } catch { /* Keep the original upload error for the per-photo retry UI. */ }
    throw cause
  }
  return uploadId
}

/** @see ../../docs/product/storage-privacy.md#photo-deletion */
export async function removePendingDayPhoto(studentToken: string, uploadId: string) {
  const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
  const current = await getDocFromServer(ref)
  if (!current.exists() || current.data().status === 'deleted') {
    await removePhotoFromOutbox(studentToken, uploadId)
    return
  }
  if (current.data().status === 'reviewed') throw new Error('Проверенную работу удалить нельзя.')
  await updateDoc(ref, { status: 'deleted', deletedAt: serverTimestamp() })
  await removePhotoFromOutbox(studentToken, uploadId)
}
