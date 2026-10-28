/** @see ../../docs/decisions/scoped-learner-flow-2026-10-21.md */
/** @see ../../docs/decisions/mesh-informational-entry-2026-10-21.md */
/** @see ../../docs/modules/materials/material-clarification.md
 * @see ../../docs/decisions/family-essay-assignment-2026-10-20.md
 * @see ../../docs/decisions/source-only-mesh-publication-2026-10-20.md
 * @see ../../docs/decisions/photo-upload-authorization-and-freshness-2026-10-20.md */
import type { MaterialRequest, SourceAnalysis } from './materialRequest'
import { collection, doc, documentId, getDoc, getDocFromServer, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { getAuth } from 'firebase/auth'
import { prepareEducationEvent, stagePreparedEducationEvent } from './educationEventProducer'
import { isExplicitCdzTask } from '../../day/homework-kind.mjs'
import { removePhotoFromOutbox, resumePhotoTransfer, savePhotoForTransfer } from './photoOutbox'
import { normalizeDayPage } from './dayCompatibility'
import { createEducationEventId } from '../../packages/education-events/envelope.mjs'

export type DayInstruction = string | { text: string; source: { kind: 'mesh' | 'textbook' | 'review' | 'teacher-file' | 'family'; label: string; evidence?: string; excerpt?: string; ref?: string; certainty: 'confirmed' | 'uncertain' } }
export type DaySubmission = { buttonLabel: string; lead?: string; items?: DayInstruction[]; photo?: string; description?: string }
export type DaySourceCrop = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number; sourceSha256: string }
export type DaySourceResearch = { status: 'candidate' | 'verified' | 'not-found' | 'conflict'; title: string; url?: string; match: string; keyStatus: 'not-checked' | 'candidate' | 'verified' | 'unavailable'; note?: string }
/** @see ../../docs/modules/reviews/adaptive-problem-card.md#слои */
export type DayProblem = {
  id: string; number: number; title: string; detail: string; source: string; variantId?: string;
  original?: { text: string; attachmentRef: string; crop?: DaySourceCrop };
  support?: { skill: string; state: 'unknown' | 'provisional' | 'practicing' | 'demonstrated'; evidence: string; evidenceRefs: string[]; facts: { label: string; value: string }[]; find: string; firstQuestion: string; revision: number };
  /** Operator source only; publish in role-protected dayTaskGuides, never in either dayPage. */
  sourceResearch?: DaySourceResearch;
  parentGuide?: ParentTaskGuide;
}
/** One data contract powers 2–4 stage mathematics and language routes.
 * Math answers belong only to the final stage; dayPages must never contain this type.
 * @see ../../docs/modules/reviews/card-generation-policy.md#math-adapter */
/** @see ../../docs/decisions/released-stage-parity-2026-10-20.md */
export type ParentTaskGuide = {
  kind: 'structured-notes' | 'worked-solution' | 'text-structure';
  presentation?: 'math-route' | 'learning-route'; pattern?: 'spelling' | 'syntax' | 'text-plan' | 'composition' | 'short-interpretation' | 'evidence-response' | 'concept-function' | 'vocabulary-list' | 'written-exercise' | 'source-analysis' | 'map-analysis' | 'source-evidence' | 'source-units'; routeProfile?: 'compact' | 'standard' | 'extended'; depthReason?: string;
  revision?: number; overview: string; boundary?: string;
  stages: {
    id: string; title: string; expected: string; why?: string; reviewLabels?: string[];
    role?: 'given' | 'relations' | 'calculation' | 'solution' | 'answer';
    rows?: { label?: string; value: string; explanation?: string }[];
    hintPreview?: string; revealPreview?: string;
    answer?: string; verification?: { label?: string; value: string }[];
    source: { kind: 'mesh' | 'textbook' | 'teacher-file' | 'family'; label: string; ref: string; excerpt: string };
  }[];
}
/** Public allowlist for a parent-approved full-stage reveal; never contains source refs/excerpts or review labels.
 * @see ../../docs/modules/reviews/subject-aware-guidance.md#data-contract */
export type DayGuidanceRevealContent = {
  title: string; expected: string; rows: { label?: string; value: string; explanation?: string }[];
  role: 'plain' | 'given' | 'relations' | 'calculation' | 'solution' | 'answer';
  why: string; answer: string; verification: { label?: string; value: string }[]; sourceLabel: string;
}
export type ParentTaskPrivate = { guide?: ParentTaskGuide; sourceResearch?: DaySourceResearch }
export type PlatformResult = { state: 'completed'; points?: number; maxPoints?: number; durationMinutes?: number; observedDate?: string; source: string; evidenceKind?: 'screenshot' | 'mesh' }
export type LearnerFlowData = { version: 1; scope: string; meshExcerpt: string; boundary: string; goal: string; source: { pageId: string; label: string; excerpt: string }; stages: { id: string; title: string; prompt: string; hint: string; frame: string; sourceLabel: string }[] }
export type DayTask = { sourceIntake?: { kind: 'olympiad-sheet' }; optional?: boolean; learningContext?: { kind: 'homework' | 'course' | 'olympiad'; id: string }; learnerFlow?: LearnerFlowData; materialRequest?: MaterialRequest; sourceOnly?: boolean; id: string; title: string; detail: string; meshText?: string; familyOrigin?: { sourceSystem: 'family'; sourceId: string; sourceRevision: number }; steps?: DayInstruction[]; problems?: DayProblem[]; practiceVariants?: { id: string; title: string; optionalByTeacher?: { sourceRef: string; excerpt: string } }[]; mathRoutePolicyVersion?: 1; cardPattern?: ParentTaskGuide['pattern']; cardPolicyVersion?: 1; outputKind?: 'worked-solution' | 'structured-notes' | 'text-structure' | 'evidence-only' | 'reading' | 'platform-result'; assessmentIntent?: { state: 'confirmed' | 'needs-topic' | 'needs-review'; mode?: 'ordinary' | 'control-diagnostic' | 'control-followup' | 'targeted-followup'; topic?: string; evidenceRef?: string }; status: 'verified' | 'needs-fix' | 'partial' | 'unknown'; kind: 'written' | 'read' | 'check'; referenceDate?: string; source: string; submission?: DaySubmission | null; instructionStatus?: { state: 'needs-review' | 'reviewed'; message: string }; testToken?: string; testSlug?: string; requiredPoints?: number; originDate?: string; lessonDate?: string; dueDate?: string; dueDateEvidence?: { kind: 'mesh'; excerpt: string }; platformResult?: PlatformResult; materialStatus?: { state: 'textbook-page-needed' | 'textbook-page-linked' | 'teacher-attachment-needed' | 'teacher-attachment-linked' | 'text-absent-from-textbook' | 'no-textbook'; message: string } }
/** @see ../../docs/modules/school-diary/day-page.md#cdz-proof */
export function cdzResultLabel(result?: PlatformResult) {
  if (result?.state !== 'completed') return 'Ожидается подтверждение ЦДЗ'
  const score = Number.isFinite(result.points) && Number.isFinite(result.maxPoints) ? ` · ${result.points}/${result.maxPoints} баллов` : ''
  const duration = Number.isFinite(result.durationMinutes) ? ` · ${result.durationMinutes} мин` : ''
  return `ЦДЗ выполнено${score}${duration}`
}
export function cdzEvidenceLabel(result?: PlatformResult) {
  if (!result) return ''
  if (result.evidenceKind === 'screenshot' || /скриншот|фото/i.test(result.source)) return 'Подтверждено скриншотом результата'
  if (result.evidenceKind === 'mesh') return 'Подтверждено данными МЭШ'
  return `Подтверждено: ${result.source}`
}
/** @see ../../docs/modules/synchronization/plan-generation.md#raw-mesh-stage */
export function isCdzTask(task: Pick<DayTask, 'id' | 'kind' | 'meshText' | 'title'>) {
  return isExplicitCdzTask(task)
}
export type DayMaterialLink = { title: string; url: string; sourceType: 'textbook-page' | 'teacher-attachment' | 'external-text' | 'audio'; reason?: string; sourceRef?: string; sharedAcrossTasks?: boolean; pdfPage?: number; printedPage?: number | null; editionStatus?: string; extraction?: string; sourceSha256?: string; sourceQuote?: string; collectionId?: string; audioKind?: 'sb' | 'wb' | 'test'; exercise?: string | null; exerciseType?: 'exercise' | 'part'; sourceUrl?: string }
export type DaySubject = { id: string; name: string; icon: string; materials: string; mesh: string; summary: string; tasks: DayTask[] }
export type DayTestPlacement = { token: string; subjectId: string; taskId?: string; originDate?: string; optional?: boolean }
/** @see ../../docs/modules/families/access-and-state.md#state */
export type DayPageData = {
  kind: 'student' | 'parent'; date: string; targetDate: string; meshFetchedAt: string;
  familyId?: string; childId?: string;
  subjects: DaySubject[]; notices: string[]; gradeSummary: { id: string; name: string; average: number; allFives?: boolean; watch?: boolean }[]; gradeAsOf?: string;
  todaySchedule: { subject: string; start: string; end: string; homework: string }[];
  targetSchedule: { subject: string; start: string; end: string; homework: string }[];
  boardToken: string; studentToken?: string; parentNotes?: string[]; testPlacements?: DayTestPlacement[];
  materialLinks?: Record<string, DayMaterialLink[]>;
  taskPageRefs?: Record<string, string[]>;
  /** Raw MESH entries that point to material already attached to another task. @see ../../docs/modules/synchronization/plan-generation.md#material-only-mesh-entries */
  sourceOnlyEntries?: ({ kind: 'notice'; id: string; subjectId: string; rawText: string; reason: string }
    | { kind:'split'; id:string; subjectId:string; targetTaskId:string; actionIds:string[]; rawText:string; reason:string }
    | { kind?: undefined; id: string; subjectId: string; targetTaskId: string; rawText: string; reason: string })[];
  retiredTaskIds?: string[];
  weekendSlot?: { dates: string[]; title: string; taskIds: string[]; dueDate?: string } | null;
  evidenceDayTokens?: string[]; planRevision?: number;
  changes?: { at: unknown; added: string[]; removed?: string[]; changed: string[]; changedSubjects?: string[]; newLinks: boolean; changedSchedule?: boolean; changedWeekendSlot?: boolean }[];
  grades?: { id: string; name: string; grades: { mark: number; weight: number; sourceId?: string; date?: string; workType?: string; comment?: string }[]; displayed_average: number; scenario_verified?: boolean }[];
  workingThreshold?: number;
}
/** @see ../../docs/modules/materials/storage-privacy.md#upload-queue */
export type DayUpload = { id: string; taskId: string; coveredTaskIds?: string[]; processingTaskIds?: string[]; coverageNote?: string; dataUrl?: string; originalName?: string; status: 'requested' | 'awaiting-upload' | 'uploaded' | 'upload-error' | 'pending' | 'reviewed'; error?: string; createdAt?: unknown; origin?: 'archive'; recordedDate?: string; upload?: { href: string }; storage?: { provider: 'yandex-disk'; state: 'stored'; path: string; size: number; md5?: string; sha256?: string; syncedAt: unknown; publicUrl?: string } }
/** Upload placement is a UI entry point; confirmed coverage can include other tasks. @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo */
export function uploadMatchesTask(upload: DayUpload, taskId: string) {
  return upload.coveredTaskIds ? upload.coveredTaskIds.includes(taskId)
    : upload.processingTaskIds ? upload.processingTaskIds.includes(taskId) : upload.taskId === taskId
}
function taskConditionOnPage(page: DayPageData | undefined, taskId: string): string | null {
  if (!page) return null
  for (const subject of page.subjects ?? []) for (const task of subject.tasks ?? []) {
    if (task.id === taskId) return JSON.stringify({ id: task.id, title: task.title, detail: task.detail,
      meshText: task.meshText ?? '', source: task.source, kind: task.kind,
      problems: (task.problems ?? []).map((problem) => ({ id: problem.id, title: problem.title, detail: problem.detail,
        originalText: problem.original?.text ?? '', attachmentRef: problem.original?.attachmentRef ?? '',
        sourceSha256: problem.original?.crop?.sourceSha256 ?? '' })),
      pageRefs: page.taskPageRefs?.[taskId] ?? [], materials: page.materialLinks?.[taskId] ?? [] })
    const problem = task.problems?.find((item) => item.id === taskId)
    if (problem) return JSON.stringify({ id: task.id, title: task.title, detail: task.detail, meshText: task.meshText ?? '',
      problem: { id: problem.id, title: problem.title, detail: problem.detail, originalText: problem.original?.text ?? '',
        attachmentRef: problem.original?.attachmentRef ?? '', sourceSha256: problem.original?.crop?.sourceSha256 ?? '' },
      pageRefs: page.taskPageRefs?.[taskId] ?? [], materials: page.materialLinks?.[taskId] ?? [] })
  }
  return null
}
export type DayHelp = { id: string; taskId: string; revision: number; requestedAt?: unknown; requestKind?: 'condition' | 'start' | 'step' | 'check'; requestText?: string; photoUploadIds?: string[]; planRevision?: number; eventReceiptId?: string }
export type DayWorkReview = {
  purpose?: 'source-material'; sourceAnalysis?: SourceAnalysis;
  id: string; taskId: string; status?: 'verified' | 'needs-fix' | 'partial' | 'cannot-assess';
  summary?: string; nextStep?: string; source?: string; checkedAt?: unknown; uploadIds?: string[];
  /** Complete set of reviewable route stages; absent on legacy reviews, which cannot be auto-completed by a family switch. */
  checkableStageIds?: string[];
  /** Student-safe source → photo → verdict per assigned MESH unit. @see ../../docs/modules/reviews/review-criteria-provenance.md#requirement-trace */
  requirementChecks?: { id: string; action: string; meshExcerpt: string; materialExcerpt: string;
    evidence: { state: 'visible' | 'outside-frame' | 'unreadable' | 'not-sent'; uploadId: string; observation: string };
    result: 'confirmed' | 'not-met' | 'partial' | 'unknown'; explanation: string }[];
  /** @see ../../docs/modules/reviews/review-criteria-provenance.md */
  assessmentBasis?: {
    grade?: number; schoolYear?: string; requirement?: string; observed?: string; comparison?: string;
    outcome: 'met' | 'not-met' | 'unresolved'; limitation?: string;
    /** Why the result is unresolved; a missing photo is not an unclear teacher criterion. */
    unresolvedReason?: 'missing-evidence' | 'criterion-unclear';
    sources?: { kind: 'teacher' | 'mesh' | 'textbook' | 'method-guide' | 'curriculum' | 'official-key'; ref: string; excerpt: string; role: 'requirement' | 'context' }[];
    disputedRequirementIds?: string[];
    /** A proposed family action is not a teacher requirement. @see ../../docs/modules/reviews/review-criteria-provenance.md#family-disputes */
    disputedRequirements?: { id: string; action: string; meshExcerpt?: string; sourceKind?: 'textbook' | 'model-inference'; sourceExcerpt?: string; sourceRef?: string; uncertainty?: string }[];
  };
  /** Operator-reviewed text safe for the student view; never generated from the private answer key in the client. */
  studentFeedback?: { title: string; confirmed: string; focus: string; question: string; anchor?: { uploadId: string; location: string } };
  /** Separate the numeric result from the reasoning visible in a mathematical solution photo. */
  mathReasoning?: { answer: 'correct' | 'incorrect' | 'uncertain'; argument: 'sufficient' | 'incomplete' | 'not-shown' | 'unreadable' | 'not-required'; observed?: string; minimumNeeded?: string; criterionSource?: string };
  /** Whether every assigned action is visibly present; independent of the teacher's quality criterion. @see ../../docs/modules/reviews/review-criteria-provenance.md#work-coverage */
  workCoverage?: { state: 'complete' | 'incomplete' | 'unknown'; note: string; sourceRef: string; reviewCheckedAt: unknown; recordedAt: unknown };
  items?: { label: string; stageId?: string; status: 'correct' | 'incorrect' | 'partial' | 'cannot-assess'; observed?: string; expected?: string; note?: string }[];
  processing?: { phase: 'download' | 'source' | 'review' | 'publish' | 'paused'; label: string; reason?: string; uploadIds: string[]; startedAt: unknown; updatedAt: unknown };
  history?: Pick<DayWorkReview, 'status' | 'summary' | 'nextStep' | 'checkedAt' | 'items' | 'uploadIds' | 'mathReasoning' | 'studentFeedback' | 'assessmentBasis'>[];
}

export async function loadDayPage(token: string): Promise<DayPageData> {
  const snapshot = await getDoc(doc(db, 'dayPages', token))
  if (!snapshot.exists()) throw new Error('Страница дня не найдена.')
  return normalizeDayPage(snapshot.data())
}
export function watchDayPage(token: string, onChange: (page: DayPageData) => void, onError: (error: Error) => void,
  options: { serverConfirmedOnly?: boolean } = {}) {
  return onSnapshot(doc(db, 'dayPages', token), { includeMetadataChanges: options.serverConfirmedOnly === true }, (snapshot) => {
    if (options.serverConfirmedOnly && snapshot.metadata?.fromCache) return
    if (!snapshot.exists()) { onError(new Error('Страница дня не найдена.')); return }
    try { onChange(normalizeDayPage(snapshot.data())) } catch (error) { onError(error as Error) }
  }, onError)
}
/** @see ../../docs/modules/synchronization/plan-generation.md#cross-day-results */
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
  if (!isCdzTask(task) || task.platformResult?.state === 'completed') return task
  const candidates = pages.filter((page) => page.targetDate === targetDate)
    .flatMap((page) => page.subjects.flatMap((subject) => subject.tasks))
    .filter((prior) => prior.id === task.id && prior.meshText === task.meshText && prior.platformResult?.state === 'completed')
    .sort((a, b) => (b.platformResult?.observedDate ?? '').localeCompare(a.platformResult?.observedDate ?? ''))
  if (!candidates.length || candidates.length > 1 && candidates[0].platformResult?.observedDate === candidates[1].platformResult?.observedDate
    && JSON.stringify(candidates[0].platformResult) !== JSON.stringify(candidates[1].platformResult)) return task
  return { ...task, status: 'verified', platformResult: candidates[0].platformResult }
}
/** @see ../../docs/modules/materials/materials.md#firestore-catalog */
export function watchMaterialPages(refs: string[], familyId: string | undefined, childId: string | undefined, onChange: (pages: Record<string, DayMaterialLink>) => void, onError: (error: Error) => void) {
  if (!familyId || !childId) { onChange({}); return () => {} }
  const unique = [...new Set(refs)]
  const pages: Record<string, DayMaterialLink> = {}
  const stops = unique.map((ref) => {
    const match = /^([a-z0-9-]+)#([1-9]\d*)$/.exec(ref)
    if (!match) { onError(new Error(`Неизвестная страница учебника: ${ref}`)); return () => {} }
    return onSnapshot(doc(db, 'families', familyId, 'children', childId, 'bookPages', ref), (snapshot) => {
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
/** @see ../../docs/modules/families/access-and-state.md#state */
export function watchDayUploads(tokens: string[], onChange: (data: DayUpload[]) => void, onError: (error: Error) => void) {
  const parts = new Map<string, DayUpload[]>()
  const unique = [...new Set(tokens)]
  const stops = unique.map((studentToken) => onSnapshot(collection(db, 'dayUploads', studentToken, 'files'), (snapshot) => {
    parts.set(studentToken, snapshot.docs.filter((item) => item.data().status !== 'deleted').map((item) => {
      const data = item.data()
      resumePhotoTransfer(studentToken, item.id, data as { status: string; upload?: { href: string }; deviceUid?: string })
      return { id: `${studentToken}:${item.id}`, ...data } as DayUpload
    }))
    if (parts.size === unique.length) onChange(unique.flatMap((token) => parts.get(token) || []))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
/** @see ../../docs/modules/school-diary/day-page.md#homework-review */
export function watchDayReviews(tokens: string[], onChange: (data: DayWorkReview[]) => void, onError: (error: Error) => void, parent = false) {
  const parts = new Map<string, DayWorkReview[]>()
  const privateParts = new Map<string, DayWorkReview[]>()
  const unique = [...new Set(tokens)]
  const emit = () => {
    if (parts.size !== unique.length || parent && privateParts.size !== unique.length) return
    onChange(unique.flatMap((token) => {
      const publicItems = parts.get(token) || []
      if (!parent) return publicItems
      const privateById = new Map((privateParts.get(token) || []).map((item) => [item.id, item]))
      return publicItems.map((item) => ({ ...item, ...privateById.get(item.id), processing: item.processing }))
    }))
  }
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
/** Parent-only prepared path; never fetch this collection on a student route.
 * @see ../../docs/modules/reviews/subject-aware-guidance.md#parent-card */
export function watchDayTaskGuides(studentToken: string, onChange: (guides: Record<string, ParentTaskPrivate>) => void,
  onError: (error: Error) => void, options: { taskIds?: string[] } = {}) {
  const selected = options.taskIds === undefined ? null : [...new Set(options.taskIds)]
  if (selected?.length === 0) { onChange({}); return () => {} }
  const refs = selected === null
    ? [collection(db, 'dayTaskGuides', studentToken, 'items')]
    : Array.from({ length: Math.ceil(selected.length / 30) }, (_, index) => query(
      collection(db, 'dayTaskGuides', studentToken, 'items'),
      where(documentId(), 'in', selected.slice(index * 30, index * 30 + 30))))
  const parts = new Map<number, Record<string, ParentTaskPrivate>>()
  const stops = refs.map((reference, index) => onSnapshot(reference, (snapshot) => {
    parts.set(index, Object.fromEntries(snapshot.docs.map((entry) => [entry.id, {
      guide: entry.data().guide as ParentTaskGuide | undefined,
      sourceResearch: entry.data().sourceResearch as DaySourceResearch | undefined,
    }])))
    if (parts.size === refs.length) onChange(Object.assign({}, ...Array.from({ length: refs.length }, (_, part) => parts.get(part))))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
/** @see ../../docs/modules/reviews/adaptive-problem-card.md#показ-ученику */
export function watchDayHelp(tokens: string[], onChange: (data: DayHelp[]) => void, onError: (error: Error) => void) {
  const parts = new Map<string, DayHelp[]>()
  const unique = [...new Set(tokens)]
  const stops = unique.map((studentToken) => onSnapshot(collection(db, 'dayHelp', studentToken, 'items'), (snapshot) => {
    parts.set(studentToken, snapshot.docs.map((item) => ({ id: `${studentToken}:${item.id}`, ...item.data() } as DayHelp)))
    onChange(unique.flatMap((token) => parts.get(token) || []))
  }, onError))
  return () => stops.forEach((stop) => stop())
}
/** Immutable request history is read only by family members. */
export function watchDayHelpHistory(studentToken: string, taskId: string, onChange: (data: DayHelp[]) => void, onError: (error: Error) => void) {
  return onSnapshot(collection(db, 'dayHelp', studentToken, 'items', taskId, 'requests'), (snapshot) => {
    onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as DayHelp)))
  }, onError)
}
export async function requestDayHelp(studentToken: string, taskId: string, revision: number, requestKind: NonNullable<DayHelp['requestKind']>, requestText: string, options?: { photoUploadIds: string[]; operationId: string }) {
  const photoUploadIds = options?.photoUploadIds
  if (photoUploadIds && (!photoUploadIds.length || new Set(photoUploadIds).size !== photoUploadIds.length || photoUploadIds.some(id => !/^[A-Za-z0-9_-]{20,80}$/.test(id)) || !/^[A-Za-z0-9-]{36}$/.test(options.operationId))) throw new Error('Выберите сохранённые фотографии задания и повторите отправку с тем же идентификатором.')
  const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
  const { familyId, childId } = owner.data() ?? {}
  const uid = getAuth().currentUser?.uid
  if (!owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string' || !uid) throw new Error('Семейная привязка запроса не найдена.')
  const input = {
    eventType: 'help.requested', familyId, childId, source: 'firestore',
    sourceRef: { kind: 'help', documentPath: `dayHelp/${studentToken}/items/${taskId}`, dayToken: studentToken, taskId },
    operationId: options?.operationId ?? crypto.randomUUID(), actor: { type: 'user', uid },
  } as const
  const envelope = await prepareEducationEvent(input)
  const sourceRef = doc(db, 'dayHelp', studentToken, 'items', taskId)
  const historyRef = doc(db, 'dayHelp', studentToken, 'items', taskId, 'requests', envelope.eventId)
  const sourceText = requestText.trim().slice(0, 800)
  const matches = (data: Record<string, unknown> | undefined) => data?.eventOperationId === input.operationId && data?.eventReceiptId === envelope.eventId
    && data?.revision === revision && data?.requestKind === requestKind && data?.requestText === sourceText
    && JSON.stringify(data?.photoUploadIds ?? null) === JSON.stringify(photoUploadIds ?? null)
  if (photoUploadIds) {
    const saved = await getDocFromServer(historyRef)
    if (saved.exists()) {
      if (matches(saved.data())) return
      throw new Error('Этот запрос уже сохранён с другими данными.')
    }
    for (let offset = 0; offset < photoUploadIds.length; offset += 20) {
      const photos = await Promise.all(photoUploadIds.slice(offset, offset + 20).map(id => getDocFromServer(doc(db, 'dayUploads', studentToken, 'files', id))))
      if (photos.some(photo => !photo.exists() || photo.data()?.taskId !== taskId || !['pending', 'reviewed'].includes(photo.data()?.status) || photo.data()?.storage?.state !== 'stored')) throw new Error('Дождитесь сохранения выбранных фотографий этого задания.')
    }
  }
  let planRevision: number | undefined
  if (photoUploadIds) {
    const page = await getDocFromServer(doc(db, 'dayPages', studentToken))
    planRevision = page.data()?.planRevision
    if (!page.exists() || !Number.isInteger(planRevision) || !page.data()?.taskIds?.includes(taskId)) throw new Error('Версия задания изменилась. Обновите страницу.')
  }
  const batch = writeBatch(db)
  const request = { taskId, revision, requestKind, requestText: sourceText, ...(photoUploadIds ? { photoUploadIds, planRevision } : {}), requestedAt: serverTimestamp(), eventOperationId: input.operationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 }
  batch.set(sourceRef, request)
  if (photoUploadIds) batch.set(historyRef, request)
  stagePreparedEducationEvent(batch, envelope)
  try { await batch.commit() }
  catch (cause) {
    try {
      const committed = await getDocFromServer(photoUploadIds ? historyRef : sourceRef)
      if (committed.exists() && matches(committed.data())) return
    } catch { /* Preserve the original commit error when readback is unavailable. */ }
    throw cause
  }
}
const photoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
/** @see ../../docs/modules/materials/storage-privacy.md#upload-queue */
export async function uploadDayPhoto(studentToken: string, taskId: string, file: File, uploadId: string = crypto.randomUUID(), visiblePage?: DayPageData) {
  if (!photoTypes.has(file.type) || !file.size || file.size > 25_000_000) throw new Error('Выберите фото JPEG, PNG, WebP или HEIC размером до 25 МБ.')
  const deviceUid = getAuth().currentUser?.uid
  if (!deviceUid) throw new Error('Сначала откройте личную ссылку Education.')
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
  await savePhotoForTransfer(studentToken, uploadId, file)
  const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
  const eventOperationId = `upload-transfer:${uploadId}:requested`
  const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
  const { familyId, childId } = owner.data() ?? {}
  if (!owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string') throw new Error('Семейная привязка загрузки не найдена.')
  const envelope = await prepareEducationEvent({
    eventType: 'upload.transfer_requested', familyId, childId, source: 'firestore',
    sourceRef: { kind: 'upload', documentPath: `dayUploads/${studentToken}/files/${uploadId}`, dayToken: studentToken, recordId: uploadId, taskId },
    operationId: eventOperationId, actor: { type: 'user', uid: deviceUid },
  } as Parameters<typeof prepareEducationEvent>[0])
  const existing = await getDocFromServer(ref)
  if (existing.exists()) {
    const data = existing.data()
    const transferEvent = data?.status === 'requested' || data?.status === 'awaiting-upload'
      ? { eventType: 'upload.transfer_requested', operationId: eventOperationId }
      : data?.status === 'uploaded'
        ? { eventType: 'upload.bytes_uploaded', operationId: `upload-transfer:${uploadId}:uploaded` }
        : ['pending', 'reviewed'].includes(data?.status)
          ? { eventType: 'upload.confirmed', operationId: `upload-confirmed:${uploadId}` }
          : undefined
    const expectedReceiptId = transferEvent && await createEducationEventId({ ...transferEvent, familyId, childId,
      source: 'firestore', sourceRef: envelope.sourceRef })
    const legacyConfirmedOperationId = `upload-transfer:${uploadId}:uploaded`
    const isLegacyConfirmedReceipt = ['pending', 'reviewed'].includes(data?.status)
      && data?.eventOperationId === legacyConfirmedOperationId
      && data?.storage?.state === 'stored' && data?.storage?.sha256 === sha256
    if (transferEvent && data?.taskId === taskId && data?.sha256 === sha256 && data?.deviceUid === deviceUid
      && (data?.eventOperationId === transferEvent.operationId || isLegacyConfirmedReceipt)
      && data?.eventReceiptId === expectedReceiptId
      && data?.eventProducerVersion === 1) return uploadId
    if (data?.status === 'upload-error') throw new Error('Передача этого фото ожидает повтора обработчиком. Не создавайте новую заявку; попробуйте позже.')
    throw new Error('Фото с таким идентификатором уже существует с другими данными. Обновите страницу и выберите фото заново.')
  }
  const pageSnapshot = await getDocFromServer(doc(db, 'dayPages', studentToken))
  const currentPage = pageSnapshot.exists() ? normalizeDayPage(pageSnapshot.data()) : undefined
  if (visiblePage && (!taskConditionOnPage(visiblePage, taskId) || !taskConditionOnPage(currentPage, taskId)
    || taskConditionOnPage(visiblePage, taskId) !== taskConditionOnPage(currentPage, taskId))) {
    throw new Error('Условие задания изменилось. Обновите страницу и проверьте карточку перед отправкой фото.')
  }
  const revision = currentPage?.planRevision
  if (!Number.isInteger(revision)) throw new Error('Не найдена текущая версия задания. Обновите страницу.')
  try {
    const batch = writeBatch(db)
    batch.set(ref, { taskId, planRevision: revision, deviceUid, contentType: file.type, size: file.size, sha256,
      status: 'requested', createdAt: serverTimestamp(), eventOperationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
    stagePreparedEducationEvent(batch, envelope)
    await batch.commit()
  } catch (cause) {
    try {
      const saved = await getDocFromServer(ref)
      if (saved.exists() && saved.data().taskId === taskId && saved.data().sha256 === sha256
        && saved.data().eventOperationId === eventOperationId && saved.data().eventReceiptId === envelope.eventId) return uploadId
    } catch { /* Keep the original upload error for the per-photo retry UI. */ }
    throw cause
  }
  return uploadId
}

/** @see ../../docs/modules/materials/storage-privacy.md#photo-deletion */
export async function removePendingDayPhoto(studentToken: string, uploadId: string) {
  const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
  const current = await getDocFromServer(ref)
  if (!current.exists() || current.data().status === 'deleted') {
    await removePhotoFromOutbox(studentToken, uploadId)
    return
  }
  if (current.data().status === 'reviewed') throw new Error('Проверенную работу удалить нельзя.')
  const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
  const { familyId, childId } = owner.data() ?? {}
  const uid = getAuth().currentUser?.uid
  if (!owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string' || !uid) throw new Error('Семейная привязка загрузки не найдена.')
  const operationId = `upload-delete:${uploadId}`
  const envelope = await prepareEducationEvent({ eventType: 'upload.delete_requested', familyId, childId, source: 'firestore',
    sourceRef: { kind: 'upload', documentPath: `dayUploads/${studentToken}/files/${uploadId}`, dayToken: studentToken, recordId: uploadId, taskId: current.data().taskId },
    operationId, actor: { type: 'user', uid } })
  const batch = writeBatch(db)
  batch.update(ref, { status: 'deleted', deletedAt: serverTimestamp(), eventOperationId: operationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
  stagePreparedEducationEvent(batch, envelope)
  try { await batch.commit() }
  catch (cause) {
    try {
      const committed = await getDocFromServer(ref)
      if (committed.data()?.status === 'deleted' && committed.data()?.eventOperationId === operationId
        && committed.data()?.eventReceiptId === envelope.eventId) {
        await removePhotoFromOutbox(studentToken, uploadId)
        return
      }
    } catch { /* Preserve the original error if commit readback is unavailable. */ }
    throw cause
  }
  await removePhotoFromOutbox(studentToken, uploadId)
}
