/** @see ../docs/modules/materials/material-clarification.md */
import MaterialRequest from '@/components/MaterialRequest'
import { materialRequestView } from '@/lib/materialRequest'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, ChevronDown, Clock3, ExternalLink, RotateCcw, Trash2, X } from 'lucide-react'
import StatusIcon from './components/StatusIcon'
// @see ../docs/shared/design/statuses.md#components
import { cdzEvidenceLabel, cdzResultLabel, isCdzTask, removePendingDayPhoto, requestDayHelp, uploadDayPhoto, uploadMatchesTask, watchDayHelp, watchDayPage, watchDayTaskGuides, watchMaterialPages, withVerifiedPlatformResult } from '@/lib/dayStore'
import { groupAdjacentMaterialPages, unresolvedMaterialPageRefs } from '@/lib/dayMaterialRefs'
import { isSubjectExpanded, visibleGuideTaskIds } from '@/lib/guideReadPolicy'
import type { DayHelp, DayInstruction, DayMaterialLink, DayPageData, DayProblem, DayTask, DayUpload, DayWorkReview, ParentTaskPrivate } from '@/lib/dayStore'
import { dayHelpSessionRole } from '@/lib/personalAccess'
import { useDayQuizOutcomes } from '@/lib/useDayQuizOutcomes'
import MaterialReader, { canReadInside } from '@/components/MaterialReader'
import EducationImage from '@/components/EducationImage'
import ArtifactAvatar, { WorkArtifactImage } from '@/components/ArtifactAvatar'
import WorkReview from '@/components/WorkReview'
import ProblemGroup from '@/components/ProblemGroup'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import ParentTaskGuide from '@/components/ParentTaskGuide'
import RequirementSwitch from '@/components/RequirementSwitch'
import AssignmentBrief from '@/components/AssignmentBrief'
import TaskGuidance from '@/components/TaskGuidance'
import PhotoUploadControl from '@/components/PhotoUploadControl'
import QuizCard from '@/components/QuizCard'
import { findQuizPlacement, quizChain, quizTaskForPlacement, withQuizPlacements, type QuizCardAttempt } from '@/lib/quizCardViewModel'
import { useDayEvidence } from '@/lib/useDayEvidence'
import { useParentCompletions } from '@/lib/useParentCompletions'
import { lessonWorkItems, quizRequirement, requiredQuizRequirement } from '@/lib/homeworkStatus'
import { pupilCanAddPhoto } from '@/lib/photoUploadPolicy'
import { assignmentProgress, assignmentTitle } from '@/lib/assignmentPresentation'
import { canAcceptCorrectAnswer, parentAccepted, recordParentCompletion, recordRequirementChoice, recordStageChoice, recordVariantChoice, requiredFamilyActions, requirementChoice, stageCompletion, practiceRequired } from '@/lib/parentCompletion'
import { activeProcessing, artifactAvatarLabel, artifactAvatarState, localArtifactAvatarState, problemCardState, showSeparateWorkReview, workCoverageComplete } from '@/lib/reviewPresentation'
import './DayPage.css'
import { reportUiError } from '@/lib/uiErrors'
import { DATA_UPDATE_MESSAGE } from '@/lib/dayCompatibility'
import DataCompatibilityNotice from './components/DataCompatibilityNotice'
import { sendDayGuidance, watchDayGuidance } from '@/lib/dayGuidance'
import type { DayGuidance } from '@/lib/dayGuidance'

type TestItem = QuizCardAttempt & { subject: string }
type LocalPhoto = { id: string; taskId: string; file: File; previewUrl: string; state: 'uploading' | 'saved' | 'failed' | 'deleting'; error?: string }

/**
 * Разделяет технический статус снимка и педагогический результат задания.
 * @see ../docs/modules/school-diary/day-page.md#photo-status
 */
function PhotoStrip({ taskTitle, evidenceLabel = 'Фото работы', studentToken, uploads, localPhotos, review, now, onRetry, onDelete }: {
  taskTitle: string; evidenceLabel?: string; studentToken: string; uploads: DayUpload[]; localPhotos: LocalPhoto[]; review?: DayWorkReview; now: number;
  onRetry: (photo: LocalPhoto) => void; onDelete: (uploadId: string) => Promise<void>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const visibleUploads = uploads.filter((upload) => !removedIds.includes(upload.id))
  const localOnly = localPhotos.filter((photo) => !removedIds.includes(`${studentToken}:${photo.id}`) && !visibleUploads.some((upload) => upload.id === `${studentToken}:${photo.id}`))
  if (!visibleUploads.length && !localOnly.length) return null
  const photoCount = visibleUploads.length + localOnly.length
  const reviewedCount = visibleUploads.filter((upload) => upload.status === 'reviewed').length
  const processingCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'processing').length
  const waitingCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'waiting').length
  const pausedCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'paused').length
  const uploadingCount = visibleUploads.filter((upload) => ['requested', 'awaiting-upload', 'uploaded'].includes(upload.status)).length + localOnly.filter((photo) => photo.state === 'uploading' || photo.state === 'saved').length
  const failedCount = visibleUploads.filter((upload) => upload.status === 'upload-error').length + localOnly.filter((photo) => photo.state === 'failed').length
  const summary = [processingCount && `${processingCount} в разборе`, waitingCount && `${waitingCount} ${waitingCount === 1 ? 'ждёт' : 'ждут'} проверки`, pausedCount && `${pausedCount} с задержкой проверки`, uploadingCount && `${uploadingCount} загружается`, failedCount && `${failedCount} не загрузилось`].filter(Boolean).join(' · ')
  const selectedUpload = visibleUploads.find((upload) => upload.id === selectedId)
  const selectedLocal = localOnly.find((photo) => `${studentToken}:${photo.id}` === selectedId)
  async function deletePhoto(id: string) {
    if (!window.confirm('Удалить это фото из задания?')) return
    setRemovingId(id)
    setDeleteError('')
    try {
      await onDelete(id)
      setRemovedIds((current) => [...current, id])
      setSelectedId(null)
    } catch (cause) {
      setDeleteError(reportUiError(cause, 'Удаление фото'))
    } finally {
      setRemovingId(null)
    }
  }
  const cdzProof = evidenceLabel === 'Подтверждение ЦДЗ'
  return <div className="day-upload-list" aria-label={`Фото задания «${taskTitle}»`}>
    <div className="day-upload-head"><strong>{evidenceLabel}</strong><span>{reviewedCount} из {photoCount} фото проверено</span></div>
    {cdzProof && <small className="day-upload-context">Снимок результата МЭШ, присланный ребёнком. Кнопки внутри снимка относятся к МЭШ.</small>}
    <div className="day-upload-strip">
      {visibleUploads.map((upload, index) => {
        const state = artifactAvatarState(upload, review, now)
        const status = artifactAvatarLabel(state)
        return <button className="day-upload-chip" type="button" key={upload.id} title={`${upload.origin === 'archive' ? 'Ранее загруженная работа' : `Фото ${index + 1}`} · ${status}`} aria-label={`Открыть фото ${index + 1}: ${status}`} aria-expanded={selectedId === upload.id} onClick={() => setSelectedId(selectedId === upload.id ? null : upload.id)}><ArtifactAvatar state={state}><WorkArtifactImage upload={upload} title={taskTitle} index={index} compact /></ArtifactAvatar></button>
      })}
      {localOnly.map((photo, index) => {
        const id = `${studentToken}:${photo.id}`
        const state = localArtifactAvatarState(photo.state)
        const status = artifactAvatarLabel(state)
        return <button className="day-upload-chip" type="button" key={photo.id} title={`Фото ${visibleUploads.length + index + 1} · ${status}`} aria-label={`Открыть фото ${visibleUploads.length + index + 1}: ${status}`} aria-expanded={selectedId === id} onClick={() => setSelectedId(selectedId === id ? null : id)}><ArtifactAvatar state={state}><EducationImage source={photo.previewUrl} alt="" compact retryControl={false} /></ArtifactAvatar></button>
      })}
    </div>
    {summary && <small className="day-upload-summary">{summary}</small>}
    {(selectedUpload || selectedLocal) && <div className="day-upload-expanded"><button className="day-upload-close" type="button" aria-label="Закрыть фото" onClick={() => setSelectedId(null)}><X size={17} aria-hidden="true" /></button>
      {selectedUpload ? <><WorkArtifactImage upload={selectedUpload} title={taskTitle} index={visibleUploads.indexOf(selectedUpload)} /><p>{selectedUpload.status === 'reviewed' ? cdzProof ? 'Результат ЦДЗ указан в карточке задания.' : review?.purpose === 'source-material' ? 'Это материал для самопроверки; наблюдения о записях показаны рядом. Фото не является результатом теста.' : 'Разбор этого задания показан в блоке «Проверка работы».' : selectedUpload.status === 'upload-error' ? selectedUpload.error ?? 'Не удалось передать фото. Удалите запись и загрузите снимок снова.' : selectedUpload.status === 'pending' ? activeProcessing(review, [selectedUpload]) ? 'Сейчас проверяем фото.' : 'Фото ждёт разбора.' : 'Исходное фото передаётся напрямую на Яндекс.Диск; дождитесь подтверждения.'} {selectedUpload.storage?.state === 'stored' ? 'Файл на Яндекс.Диске.' : 'Исходник остаётся на этом устройстве до передачи.'}</p>{selectedUpload.storage?.publicUrl && <a className="day-upload-original" href={selectedUpload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>}</>
        : selectedLocal && <><EducationImage source={selectedLocal.previewUrl} alt={`Новое фото по заданию «${taskTitle}»`} className="day-upload-photo" /><p>{selectedLocal.state === 'failed' ? selectedLocal.error ?? 'Не удалось загрузить фото.' : selectedLocal.state === 'saved' ? 'Фото сохранено и ждёт разбора.' : selectedLocal.state === 'deleting' ? 'Удаляем фото…' : 'Фото загружается…'}</p>{selectedLocal.state === 'failed' && removingId !== selectedId && <button type="button" className="day-upload-retry" onClick={() => onRetry(selectedLocal)}><RotateCcw size={14} aria-hidden="true" /> Повторить</button>}</>}
      {(selectedUpload && selectedUpload.status !== 'reviewed' || selectedLocal) && <button className="day-upload-delete" type="button" disabled={removingId === selectedId} onClick={() => selectedId && void deletePhoto(selectedId)}><Trash2 size={14} aria-hidden="true" /> {removingId === selectedId ? 'Удаляем…' : 'Удалить фото'}</button>}
      {deleteError && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
    </div>}
  </div>
}

/** Adapter from a task's exact MESH instruction and family pages to the shared quiz card.
 * @see ../docs/modules/reviews/card-generation-policy.md#quiz-adapter
 * @see ../docs/modules/school-diary/day-page.md#multiple-assignments */
function QuizLineageCard({ chain, parent, task, materialLinks = [], assignmentLabel, separateAssignment = false, sourceEvidence }: { chain: QuizCardAttempt[]; parent: boolean; task?: DayTask; materialLinks?: DayMaterialLink[]; assignmentLabel?: string; separateAssignment?: boolean; sourceEvidence?: ReactNode }) {
  const context = task?.title.match(/Упр\.\s*\d+/i)?.[0] ?? task?.title ?? 'Самопроверка'
  const readerLinks = materialLinks.filter(canReadInside)
  const otherLinks = materialLinks.filter((link) => !canReadInside(link))
  const materials = task && (task.steps?.length || readerLinks.length || otherLinks.length) ? <>{!!task.steps?.length && <ol className="day-task-steps">{task.steps.map((step, index) => <Instruction key={index} item={step} index={index} />)}</ol>}{groupAdjacentMaterialPages(readerLinks).map((group) => <MaterialReader key={group[0].url} links={group} parent={parent} />)}{otherLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.title} <ExternalLink size={13} aria-hidden="true" /></a>)}</> : undefined
  // @see ../docs/modules/school-diary/day-page.md#numbered-sheet-and-quiz
  // A numbered teacher sheet remains its own task beside the linked quiz.
  return <QuizCard chain={chain} parent={parent} context={context} assignment={!separateAssignment && task && <>{assignmentLabel && <div className="day-task-assignment-heading">{assignmentLabel}</div>}<AssignmentBrief task={task} materialLinks={materialLinks} />{sourceEvidence}</>} materials={separateAssignment ? undefined : materials} id={task && !separateAssignment ? `day-task-${task.id}` : `day-quiz-${chain[0].token}`} />
}

/** @see ../docs/modules/school-diary/day-page.md#instruction-provenance */
function Instruction({ item, index }: { item: DayInstruction; index: number }) {
  const source = typeof item === 'string' ? undefined : item.source
  const uncertain = !source || source.certainty === 'uncertain'
  const text = typeof item === 'string' ? item : item.text
  return <li><span>{text}</span>{' '}
    <details className={`day-instruction-source${uncertain ? ' uncertain' : ''}`}>
      <summary title={uncertain ? 'Источник не подтверждён. Показать пояснение' : `Откуда взят пункт ${index + 1}`} aria-label={uncertain ? `Источник пункта ${index + 1} не подтверждён. Показать пояснение` : `Откуда взят пункт ${index + 1}`}>?</summary>
      <span className="day-instruction-source-body"><button className="day-instruction-source-close" type="button" aria-label="Закрыть пояснение" onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>×</button>{source ? <><b>{source.label}</b><span>{source.evidence}</span>{source.ref && <small>{source.ref}</small>}{uncertain && <em>Это не подтверждённое требование учителя.</em>}</> : <><b>Источник не указан</b><span>Не считай это дополнительным требованием учителя, пока источник не сверят.</span></>}</span>
    </details>
  </li>
}

function shortDate(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }
function dayMonth(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }
function fives(count: number) { return count === 1 ? 'пятёрка' : count >= 2 && count <= 4 ? 'пятёрки' : 'пятёрок' }
function formatAverage(value: number) { return value.toFixed(2).replace('.', ',') }
function formatChange(value: number) { return `${value >= 0 ? '+' : '−'}${formatAverage(Math.abs(value))}` }
function localMinutes() { const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Moscow' }).format(new Date()).split(':').map(Number); return parts[0] * 60 + parts[1] }
function moscowToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
/** @see ../docs/modules/school-diary/day-page.md#day-page */
function activeView(page: DayPageData): 'homework' | 'school' {
  if (page.date !== moscowToday()) return 'school'
  const last = page.todaySchedule.map((lesson) => lesson.end).sort().at(-1)
  if (!last) return 'homework'
  const [hour, minute] = last.split(':').map(Number)
  return localMinutes() < hour * 60 + minute ? 'school' : 'homework'
}
function statusLabel(status: DayTask['status']) { return ({ verified: 'Проверено', 'needs-fix': 'Нужно исправить', partial: 'Часть сделана', unknown: 'Статус неизвестен' })[status] }
/** @see ../docs/modules/school-diary/grades.md#grade-badge */
function forecast(grades: { mark: number; weight: number }[], next: number, nextWeight: number, threshold: number) {
  const points = grades.reduce((sum, { mark, weight }) => sum + mark * weight, 0) + next * nextWeight
  const weight = grades.reduce((sum, { weight: value }) => sum + value, 0) + nextWeight
  const average = points / weight
  const needed = Math.max(0, Math.ceil((threshold * weight - points) / (5 - threshold) - 1e-8))
  return { average, needed }
}

type GradeSummary = DayPageData['gradeSummary'][number]
type GradeDetails = NonNullable<DayPageData['grades']>[number]
const scheduleGradeIds: Record<string, string> = {
  'Английский язык': 'english', 'Математика': 'math', 'Русский язык': 'russian',
  'Литература': 'literature', 'История': 'history', 'Биология': 'biology',
  'Технология': 'technology', 'Изобразительное искусство': 'art', 'ИЗО': 'art',
  'География': 'geography',
}
function isExcellent(summary: GradeSummary) { return summary.allFives ?? summary.average >= 4.99 }
function needsAttention(summary: GradeSummary) { return !isExcellent(summary) && (summary.watch ?? summary.average < 4.7) }
function canForecast(summary: GradeSummary, details?: GradeDetails) {
  if (!details?.scenario_verified || !details.grades?.length || details.grades.some(({ mark, weight }) => !Number.isFinite(mark) || !Number.isFinite(weight) || weight <= 0)) return false
  const points = details.grades.reduce((sum, { mark, weight }) => sum + mark * weight, 0)
  const weight = details.grades.reduce((sum, { weight: value }) => sum + value, 0)
  return Math.abs(points / weight - summary.average) < 0.015
}
/**
 * Компактная метка среднего с условным сценарием при наличии сверенных оценок.
 * @see ../docs/modules/school-diary/grades.md#grade-badge
 */
export function GradeBadge({ summary, details, threshold, asOf }: { summary?: GradeSummary; details?: GradeDetails; threshold?: number; asOf?: string }) {
  const [open, setOpen] = useState(false)
  const [nextMark, setNextMark] = useState(4)
  const [nextWeight, setNextWeight] = useState(1)
  if (!summary) return null
  const excellent = isExcellent(summary)
  const tone = excellent ? ' excellent' : needsAttention(summary) ? ' watch' : ''
  const reliable = canForecast(summary, details) && threshold != null && threshold > 0 && threshold < 5
  const result = reliable ? forecast(details!.grades, nextMark, nextWeight, threshold!) : null
  return <>
    <button type="button" className={`day-grade${tone} day-grade-button`} aria-expanded={open} aria-label={`Средний по предмету ${formatAverage(summary.average)}. ${open ? 'Скрыть' : 'Показать'} сценарий следующей оценки`} onClick={() => setOpen((value) => !value)}><span>{formatAverage(summary.average)}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="day-grade-expand"><div className="day-grade-box">
      {result ? <>
        <div className="day-grade-toolbar"><span className="day-grade-expand-title">Оценка</span><div className="day-grade-choices" role="group" aria-label="Следующая оценка">{[3, 4, 5].map((mark) => <button key={mark} type="button" aria-pressed={nextMark === mark} onClick={() => setNextMark(mark)}>{mark}</button>)}</div><label className="day-grade-weight">Вес <select aria-label="Вес следующей оценки: ×1 обычная, ×2 условная" value={nextWeight} onChange={(event) => setNextWeight(Number(event.target.value))}><option value="1">×1</option><option value="2">×2</option></select></label></div>
        <p className="day-grade-result"><strong>{formatAverage(summary.average)} → {formatAverage(result.average)}</strong><span>{formatChange(result.average - summary.average)} · {result.needed === 0 ? 'ориентир сохранится' : `ещё ${result.needed} ${fives(result.needed)} до ориентира`}</span></p>
      </> : <p className="day-grade-unavailable">Прогноз ждёт сверки всех оценок. Текущий средний — {formatAverage(summary.average)}.</p>}
      <small>{asOf ? `Срез ${dayMonth(asOf)} · ` : ''}порог {threshold ? formatAverage(threshold) : 'не задан'} и вес ×2 условны · годовая отметка не рассчитана</small>
    </div></div>}
  </>
}

/**
 * Показывает план дня и связывает задания с фото, материалами и тестами.
 * @see ../docs/modules/school-diary/day-page.md#day-page
 * @see ../docs/modules/school-diary/day-page.md#day-navigation
 * @see ../docs/modules/families/access-and-state.md#state
 * @see ../docs/modules/synchronization/global-sync.md#status
 */
/** @see ../docs/shared/design/README.md#shell */
export default function DayPage({ token, parent, headerReturnTarget }: { token: string; parent: boolean; headerReturnTarget: HTMLElement | null }) {
  /** @see ../docs/modules/school-diary/dashboard.md#day-navigation */
  const [requestedView] = useState(() => {
    const query = new URLSearchParams(window.location.search).get('tab')
    const stored = sessionStorage.getItem('education-day-initial-tab')
    sessionStorage.removeItem('education-day-initial-tab')
    return query ?? stored
  })
  const [returnToDashboard] = useState(() => {
    const saved = sessionStorage.getItem('education-day-dashboard-return') ?? ''
    return /^#\/days(?:-parent)?\/[A-Za-z0-9_-]{20,}$/.test(saved) ? saved.replace('#/days-parent/', '#/days/') : ''
  })
  const [page, setPage] = useState<DayPageData>()
  const [catalogState, setCatalogState] = useState<{ key: string; pages: Record<string, DayMaterialLink> }>({ key: '', pages: {} })
  const [helpRequests, setHelpRequests] = useState<DayHelp[]>([])
  const [guideSnapshot, setGuideSnapshot] = useState<{ token: string; guides: Record<string, ParentTaskPrivate> }>({ token: '', guides: {} })
  const [guidanceSnapshot, setGuidanceSnapshot] = useState<{ token: string; items: DayGuidance[] }>({ token: '', items: [] })
  const [helpRole, setHelpRole] = useState<'checking' | 'student' | 'parent' | 'none'>('checking')
  /** @see ../docs/modules/school-diary/day-page.md#completed-subjects */
  const [subjectOpen, setSubjectOpen] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<'homework' | 'school'>(requestedView === 'homework' ? 'homework' : 'school')
  const [manualView, setManualView] = useState(requestedView === 'homework' || requestedView === 'school')
  const [error, setError] = useState('')
  const quizOutcomes = useDayQuizOutcomes(page, page?.targetDate ?? '', setError)
  const tests: TestItem[] = Object.entries(quizOutcomes.tests).map(([quizToken, assignment]) => {
    const entry = quizOutcomes.boardEntries.find((item) => item.token === quizToken)
    const score = quizOutcomes.scores[quizToken]
    return {
      token: quizToken, testId: assignment.testId, linkedToTestId: assignment.linkedToTestId,
      title: entry?.title ?? assignment.title, description: assignment.description,
      subject: entry?.subject ?? assignment.subject, slug: entry?.slug ?? '', previewToken: entry?.previewToken,
      status: assignment.status, answered: Object.values(assignment.answers ?? {}).filter((answer) => answer !== '' && (!Array.isArray(answer) || answer.length > 0)).length,
      total: assignment.questions.length, points: score?.points, maxPoints: score?.maxPoints,
      results: quizOutcomes.results?.[quizToken],
      createdAt: assignment.createdAt, startedAt: assignment.startedAt, updatedAt: assignment.updatedAt, submittedAt: assignment.submittedAt,
      followupRequested: Boolean(assignment.followupRequestedAt),
      familyOptional: Boolean(assignment.familyOptional),
    }
  })
  const { studentToken, evidenceKey, uploads, reviews, evidencePages, ready: evidenceReady } = useDayEvidence(page, token, setError)
  const parentDecisions = useParentCompletions(evidenceKey, Boolean(page) && helpRole !== 'checking' && helpRole !== 'none')
  const taskGuides = parent && helpRole === 'parent' && guideSnapshot.token === studentToken ? guideSnapshot.guides : {}
  useEffect(() => {
    if (!page || helpRole === 'checking' || helpRole === 'none') return
    return watchDayGuidance(studentToken, (items) => setGuidanceSnapshot({ token: studentToken, items }), (cause) => setError(reportUiError(cause, 'Подсказки к заданиям')))
  }, [page, helpRole, studentToken])
  const guidance = guidanceSnapshot.token === studentToken ? guidanceSnapshot.items : []
  const guidanceReady = guidanceSnapshot.token === studentToken
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([])
  const [statusNow, setStatusNow] = useState(() => Date.now())
  const photoUrls = useRef(new Set<string>())
  const uploadJobs = useRef(new Map<string, Promise<void>>())
  /** @see ../docs/modules/school-diary/dashboard.md#schedule-homework-status */
  const [focusTaskId] = useState(() => {
    const stored = sessionStorage.getItem('education-day-focus-task')
    sessionStorage.removeItem('education-day-focus-task')
    if (!stored) return ''
    try { const request = JSON.parse(stored) as { dayToken: string; taskId: string }; return request.dayToken === token ? request.taskId : '' }
    catch { return '' }
  })
  const focusHandled = useRef({ initial: false, settled: false })
  const focusedQuizPlacement = focusTaskId.startsWith('quiz:') && page
    ? findQuizPlacement((page.testPlacements ?? []).filter((placement) => (placement.originDate ?? page.targetDate) === page.targetDate), tests, focusTaskId.slice(5))
    : undefined
  useEffect(() => {
    if (!focusTaskId) return
    const cancelPendingAlignment = () => { focusHandled.current.settled = true }
    window.addEventListener('wheel', cancelPendingAlignment, { passive: true })
    window.addEventListener('touchstart', cancelPendingAlignment, { passive: true })
    window.addEventListener('pointerdown', cancelPendingAlignment, { passive: true })
    window.addEventListener('keydown', cancelPendingAlignment)
    return () => {
      window.removeEventListener('wheel', cancelPendingAlignment)
      window.removeEventListener('touchstart', cancelPendingAlignment)
      window.removeEventListener('pointerdown', cancelPendingAlignment)
      window.removeEventListener('keydown', cancelPendingAlignment)
    }
  }, [focusTaskId])

  useEffect(() => () => { for (const url of photoUrls.current) URL.revokeObjectURL(url) }, [])
  const hasPendingUploads = uploads.some((upload) => upload.status === 'pending')
  useEffect(() => {
    if (!hasPendingUploads) return
    const timer = window.setInterval(() => setStatusNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [hasPendingUploads])
  useEffect(() => {
    const saved = localPhotos.filter((item) => item.state === 'saved' && uploads.some((upload) => upload.id === `${studentToken}:${item.id}` && (upload.status === 'pending' || upload.status === 'reviewed')))
    if (!saved.length) return
    for (const item of saved) { URL.revokeObjectURL(item.previewUrl); photoUrls.current.delete(item.previewUrl) }
    const ids = new Set(saved.map((item) => item.id))
    setLocalPhotos((current) => current.filter((item) => !ids.has(item.id)))
  }, [localPhotos, uploads, studentToken])

  useEffect(() => {
    let active = true
    const stop = watchDayPage(token, (data) => {
      if (!active) return
      if ((parent && data.kind !== 'parent') || (!parent && data.kind !== 'student')) { setError('Эта ссылка предназначена для другой страницы.'); return }
      setPage(data)
    }, (cause) => { if (active) setError(reportUiError(cause, 'Страница задания')) })
    return () => { active = false; stop() }
  }, [token, parent])
  const materialProjectionKey = page ? JSON.stringify({
    familyId: page.familyId, childId: page.childId, refs: unresolvedMaterialPageRefs(page),
  }) : ''
  const catalogPages = catalogState.key === materialProjectionKey ? catalogState.pages : {}
  useEffect(() => {
    if (!materialProjectionKey) return
    const { refs, familyId, childId } = JSON.parse(materialProjectionKey) as { refs: string[]; familyId?: string; childId?: string }
    if (!refs.length) return
    return watchMaterialPages(refs, familyId, childId, (pages) => setCatalogState({ key: materialProjectionKey, pages }), (cause) => {
      reportUiError(cause, 'Страницы учебника')
    })
  }, [materialProjectionKey])

  const hasPage = Boolean(page)
  useEffect(() => {
    let active = true
    if (!page) return
    void dayHelpSessionRole({ familyId: page.familyId, childId: page.childId }).then((role) => { if (active) setHelpRole(role ?? 'none') })
    return () => { active = false }
  }, [page])
  useEffect(() => {
    if (!hasPage || helpRole === 'checking' || helpRole === 'none') return
    return watchDayHelp(evidenceKey.split('|'), setHelpRequests, (cause) => {
      if ((cause as Error & { code?: string }).code === 'permission-denied') { setHelpRole('none'); setHelpRequests([]) }
      else setError(reportUiError(cause, 'Страница задания'))
    })
  }, [evidenceKey, hasPage, helpRole])
  useEffect(() => {
    if (!page || manualView) return
    const update = () => setView(activeView(page))
    update()
    const timer = window.setInterval(update, 60_000)
    return () => window.clearInterval(timer)
  }, [page, manualView])
  useEffect(() => {
    if (!page || view !== 'homework' || !focusTaskId) return
    const settled = evidenceReady && parentDecisions.ready
    if (focusHandled.current.settled || focusHandled.current.initial && !settled) return
    const frame = window.requestAnimationFrame(() => {
      const target = focusTaskId.startsWith('quiz:')
        ? document.getElementById(`day-quiz-${focusTaskId.slice(5)}`) ?? (focusedQuizPlacement && document.getElementById(focusedQuizPlacement.taskId ? `day-task-${focusedQuizPlacement.taskId}` : `day-quiz-${focusedQuizPlacement.token}`))
        : document.getElementById(focusTaskId) ?? document.getElementById(`day-task-${focusTaskId}`)
      if (!target) return
      if (target.closest('.day-subject-content[hidden], .problem-group-body[hidden]')) { focusHandled.current.settled = true; return }
      if (target instanceof HTMLDetailsElement) target.open = true
      target.scrollIntoView({ behavior: 'auto', block: 'start' })
      target.classList.add('day-focused-task')
      focusHandled.current.initial = true
      if (settled) focusHandled.current.settled = true
      window.setTimeout(() => target.classList.remove('day-focused-task'), 5000)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [page, view, focusTaskId, evidenceReady, parentDecisions.ready, focusedQuizPlacement])
  const currentPlacements = useMemo(() => (page?.testPlacements ?? []).filter((placement) => (placement.originDate ?? page?.targetDate) === page?.targetDate), [page])
  const requiredDayTests = currentPlacements.flatMap((placement) => {
    const chain = quizChain(tests.find((item) => item.token === placement.token), tests)
    return chain.length && !chain[0].familyOptional ? [chain[chain.length - 1]] : []
  })
  const quizStates = Object.fromEntries(tests.map((test) => [test.token, { status: test.status, testId: test.testId, linkedToTestId: test.linkedToTestId, title: test.title, followupRequested: test.followupRequested, familyOptional: test.familyOptional }]))
  const quizScores = Object.fromEntries(tests.filter((test) => test.points != null && test.maxPoints != null)
    .map((test) => [test.token, { points: test.points!, maxPoints: test.maxPoints! }]))
  const pending = (() => {
    if (!page) return 0
    const taskPending = page.subjects.flatMap((subject) => subject.tasks.map((task) => ({ subject, task }))).filter(({ task }) => (task.originDate ?? page.targetDate) === page.targetDate).filter(({ subject, task }) => {
      const placements = currentPlacements.filter((placement) => placement.subjectId === subject.id)
      const testToken = task.testToken ?? placements.find((placement) => quizTaskForPlacement(subject.tasks, placements, placement)?.id === task.id)?.token
      // The heading must use the same evidence and completion rules as the cards.
      return lessonWorkItems([{ ...withVerifiedPlatformResult(task, page.targetDate, evidencePages), testToken }], uploads, reviews, parentDecisions.events, quizStates, quizScores).some((item) => item.state !== 'done')
    }).length
    const testPending = currentPlacements.filter((placement) => !page.subjects.some((subject) => quizTaskForPlacement(subject.tasks, currentPlacements.filter((item) => item.subjectId === subject.id), placement))
      && !['done', 'optional'].includes(quizRequirement(placement.token, quizStates, quizScores).state)).length
    return taskPending + testPending
  })()
  const currentSubjects = page ? page.subjects.map((subject) => {
    const tasks = subject.tasks.filter((task) => (task.originDate ?? page.targetDate) === page.targetDate)
      .map((task) => withVerifiedPlatformResult(task, page.targetDate, evidencePages))
    const placements = currentPlacements.filter((placement) => placement.subjectId === subject.id)
    return { ...subject, tasks: withQuizPlacements(tasks, placements) }
  })
    .filter((subject) => subject.tasks.length || currentPlacements.some((placement) => placement.subjectId === subject.id && !placement.taskId)) : []
  const workItems = (tasks: DayTask[]) => lessonWorkItems(tasks, uploads, reviews, parentDecisions.events, quizStates, quizScores)
  const referencedWorkItems = (subject: (typeof currentSubjects)[number]) => {
    const referenceTask = subject.tasks.find((task) => task.referenceDate)
    const referencePage = referenceTask && evidencePages.find((candidate) => candidate.targetDate === referenceTask.referenceDate)
    const referenceSubject = referencePage?.subjects.find((candidate) => candidate.id === subject.id)
    return referenceSubject ? workItems(referenceSubject.tasks.map((task) => withVerifiedPlatformResult(task, referencePage!.targetDate, evidencePages))) : []
  }
  const visibleGuideIds = parent && page && view === 'homework'
    ? visibleGuideTaskIds(currentSubjects, subjectOpen, (subject) => {
      const items = [...workItems(subject.tasks), ...referencedWorkItems(subject)]
      return items.length > 0 && items.every((item) => item.state === 'done')
    }) : []
  const guideReadKey = JSON.stringify(visibleGuideIds)
  const hasGuidePage = Boolean(page)
  useEffect(() => {
    if (!parent || !hasGuidePage || helpRole !== 'parent') return
    let active = true
    const stop = watchDayTaskGuides(studentToken, (guides) => { if (active) setGuideSnapshot({ token: studentToken, guides }) }, (cause) => {
      if (!active) return
      setGuideSnapshot({ token: '', guides: {} })
      if ((cause as Error & { code?: string }).code === 'permission-denied') setHelpRole('none')
      setError(reportUiError(cause, 'Ориентиры для проверки'))
    }, { taskIds: JSON.parse(guideReadKey) as string[] })
    return () => { active = false; stop() }
  }, [parent, hasGuidePage, helpRole, studentToken, guideReadKey])
  async function sendPhoto(photo: LocalPhoto) {
    setLocalPhotos((current) => current.map((item) => item.id === photo.id && item.state !== 'deleting' ? { ...item, state: 'uploading', error: undefined } : item))
    try {
      await uploadDayPhoto(studentToken, photo.taskId, photo.file, photo.id, page?.planRevision)
      setLocalPhotos((current) => current.map((item) => item.id === photo.id && item.state !== 'deleting' ? { ...item, state: 'saved' } : item))
    } catch (cause) {
      reportUiError(cause, 'Загрузка фото')
      setLocalPhotos((current) => current.map((item) => item.id === photo.id && item.state !== 'deleting'
        ? { ...item, state: 'failed', error: cause instanceof Error ? cause.message : 'Не удалось загрузить фото.' } : item))
    }
  }
  function queuePhotoUpload(photo: LocalPhoto) {
    const job = sendPhoto(photo)
    uploadJobs.current.set(photo.id, job)
    void job.finally(() => { if (uploadJobs.current.get(photo.id) === job) uploadJobs.current.delete(photo.id) })
  }
  async function deletePhoto(qualifiedId: string) {
    const colon = qualifiedId.indexOf(':')
    if (colon < 1) throw new Error('Не удалось определить фото. Обновите страницу.')
    const ownerToken = qualifiedId.slice(0, colon)
    const uploadId = qualifiedId.slice(colon + 1)
    const local = localPhotos.find((photo) => photo.id === uploadId)
    if (local) setLocalPhotos((current) => current.map((photo) => photo.id === uploadId ? { ...photo, state: 'deleting' } : photo))
    try {
      await uploadJobs.current.get(uploadId)
      await removePendingDayPhoto(ownerToken, uploadId)
      if (local) {
        URL.revokeObjectURL(local.previewUrl)
        photoUrls.current.delete(local.previewUrl)
        setLocalPhotos((current) => current.filter((photo) => photo.id !== uploadId))
      }
    } catch (cause) {
      if (local) setLocalPhotos((current) => current.map((photo) => photo.id === uploadId ? { ...photo, state: 'failed', error: cause instanceof Error ? cause.message : 'Не удалось удалить фото.' } : photo))
      throw cause
    }
  }
  function attach(task: { id: string }, files: File[]) {
    if (!files.length) return
    const photos = files.map((file) => {
      const previewUrl = URL.createObjectURL(file)
      photoUrls.current.add(previewUrl)
      return { id: crypto.randomUUID(), taskId: task.id, file, previewUrl, state: 'uploading' as const }
    })
    setLocalPhotos((current) => [...current, ...photos])
    for (const photo of photos) queuePhotoUpload(photo)
  }

  /** Resolved notes remain evidence when the read task moves into QuizCard.
   * @see ../docs/modules/materials/material-clarification.md */
  function sourceEvidence(task?: DayTask) {
    const request = task?.materialRequest
    if (!task || request?.state !== 'resolved') return undefined
    const review = reviews.find(item => item.taskId === task.id && item.purpose === 'source-material')
    return <><MaterialRequest request={request} label="Тема уточнена" detail={request.resolvedTopic ?? ''} analysis={review?.sourceAnalysis} />
      <PhotoStrip taskTitle={task.title} evidenceLabel="Материал для самопроверки" studentToken={studentToken} uploads={uploads.filter(upload => uploadMatchesTask(upload, task.id))} localPhotos={localPhotos.filter(photo => photo.taskId === task.id)} review={review} now={statusNow} onRetry={queuePhotoUpload} onDelete={deletePhoto} /></>
  }
  if (error === DATA_UPDATE_MESSAGE) return <DataCompatibilityNotice />
  if (error && !page) return <div className="day-error"><h1>Не получилось открыть страницу</h1><p>{error}</p></div>
  if (!page) return <p className="day-loading">Загружаем страницу дня…</p>
  const noSpecialHomework = page.targetSchedule.some((lesson) => /Спецкурс|Специальный курс/i.test(lesson.subject))
    && !currentSubjects.some((subject) => subject.id === 'special')
  const currentTaskIds = new Set(currentSubjects.flatMap((subject) => subject.tasks.map((task) => task.id)))
  const lastChange = page.changes?.[0]
  const currentAdded = lastChange?.added.filter((id) => currentTaskIds.has(id)) ?? []
  const currentChanged = lastChange?.changed.filter((id) => currentTaskIds.has(id)) ?? []

  return <>{headerReturnTarget && createPortal(<a className="day-return day-return-header" href={returnToDashboard || '#/'}>← На главную</a>, headerReturnTarget)}<div className={`day-page ${parent ? 'day-parent' : 'day-student'}`}>
    <a className="day-return day-return-content" href={returnToDashboard || '#/'}>← На главную</a>
    <section className="day-hero">
      <div className="day-kicker">{parent ? 'Панель родителя' : 'Мой план'} · {shortDate(page.date)}</div>
      <h1>{view === 'school' ? 'Расписание' : 'Домашнее задание'}</h1>
      <p>{shortDate(view === 'school' ? page.date : page.targetDate).replace(/^./u, letter => letter.toUpperCase())}{view === 'homework' && currentSubjects.some(subject => subject.tasks.some(task => task.dueDate && task.dueDate !== page.targetDate)) && '. Отдельные сроки указаны у заданий.'}</p>
      <div className="day-summary"><strong>{pending}</strong><span>{pending === 1 ? 'действие к этой дате осталось' : 'действий к этой дате осталось'}</span>{requiredDayTests.length > 0 && <><span className="day-summary-separator">·</span><span>{requiredDayTests.filter((test) => test.status === 'submitted').length} из {requiredDayTests.length} обязательных тестов завершено</span></>}</div>
    </section>

    <div className="day-tabs" role="tablist" aria-label="Раздел страницы дня">
      <button role="tab" aria-selected={view === 'school'} className={view === 'school' ? 'active' : ''} onClick={() => { setManualView(true); setView('school') }}>Расписание</button>
      <button role="tab" aria-selected={view === 'homework'} className={view === 'homework' ? 'active' : ''} onClick={() => { setManualView(true); setView('homework') }}>Задания</button>
    </div>
    {error && <div className="day-inline-error" role="alert">{error}</div>}

    {view === 'school' ? <section className="day-schedule-panel">
      <h2>Расписание · {shortDate(page.date)}</h2>
      <p>Проводимые уроки по МЭШ с учётом семейных уточнений.{page.gradeAsOf && ` Средние оценки — по срезу на ${dayMonth(page.gradeAsOf)}.`}</p>
      <div className="day-timeline">{page.todaySchedule.map((lesson, index) => {
        const id = scheduleGradeIds[lesson.subject]
        const summary = page.gradeSummary.find((item) => item.id === id)
        const grade = page.grades?.find((item) => item.id === id)
        return <div className="day-lesson" key={`${lesson.start}-${index}`}><time>{lesson.start}<br />{lesson.end}</time><div className="day-lesson-main"><div className="day-lesson-heading"><strong>{lesson.subject}</strong><GradeBadge summary={summary} details={grade} threshold={page.workingThreshold} asOf={page.gradeAsOf} /></div>{lesson.homework && <p>{lesson.homework}</p>}</div></div>
      })}</div>
      <h3>{shortDate(page.targetDate).replace(/^./u, letter => letter.toUpperCase())}</h3>
      <div className="day-next-schedule">{page.targetSchedule.map((lesson, index) => <span key={`${lesson.start}-${index}`}>{lesson.start} {lesson.subject}</span>)}</div>
    </section> : <>
      {parent && page.parentNotes?.[0] && <section className="day-attention"><h2>О задании</h2><p>{page.parentNotes[0]}</p></section>}
      {parent && (currentAdded.length > 0 || currentChanged.length > 0) && <section className="day-attention"><h2>Что изменилось</h2><p>Добавлено: {currentAdded.length}. Уточнено: {currentChanged.length}.</p></section>}
      {page.notices[0] && !parent && <div className="day-notices"><p>✳ {page.notices[0]}</p></div>}
      <h2 className="day-homework-heading">По предметам</h2>
      {currentSubjects.length === 0 && <div className="day-notices"><p>На эту дату задания в МЭШ пока не указаны.</p></div>}

      <div className="day-subject-list">{currentSubjects.map((subject) => {
        const summary = page.gradeSummary.find((item) => item.id === subject.id)
        const grade = page.grades?.find((item) => item.id === subject.id)
        const subjectPlacements = currentPlacements.filter((placement) => placement.subjectId === subject.id)
        const lineages = subjectPlacements.map((placement) => ({ placement, chain: quizChain(tests.find((item) => item.token === placement.token), tests) })).filter(({ chain }) => chain.length > 0)
        const lineageByToken = new Map(lineages.map(({ placement, chain }) => [placement.token, chain]))
        const referencedItems = referencedWorkItems(subject)
        const standalonePlacements = subjectPlacements.filter((placement) => !subject.tasks.some((task) => task.testToken === placement.token))
        const subjectItems = [...workItems(subject.tasks), ...standalonePlacements.flatMap((placement) => {
          const requirement = requiredQuizRequirement(placement.token, quizStates, quizScores)
          return requirement ? [{ id: `quiz:${placement.token}`, title: 'Самопроверка', ...requirement }] : []
        }), ...referencedItems]
        const doneCount = subjectItems.filter((item) => item.state === 'done').length
        const assignments = assignmentProgress(subject.tasks, (task) => workItems([task]))
        const numberedSheet = subject.tasks.length === 1 && Boolean(subject.tasks[0].problems?.length)
        const numberedProblemIds = new Set(numberedSheet ? subject.tasks[0].problems!.filter((problem) => !problem.variantId || practiceRequired(subject.tasks[0], problem.variantId, parentDecisions.events)).map((problem) => problem.id) : [])
        const numberedDone = subjectItems.filter((item) => numberedProblemIds.has(item.id) && item.state === 'done').length
        const meshOnlyTasks = subject.tasks.filter((task) => !task.problems?.length)
        const subjectDone = assignments.multiple ? assignments.complete : subjectItems.length > 0 && subjectItems.every((item) => item.state === 'done')
        const focused = Boolean(focusTaskId && (subject.tasks.some((task) => task.id === focusTaskId || task.problems?.some((problem) => problem.id === focusTaskId)) || subjectPlacements.some((placement) => placement.token === focusedQuizPlacement?.token)))
        const expanded = isSubjectExpanded(subject.id, subjectDone, subjectOpen, focused)
        return <section className={`day-subject day-subject-${subject.id}${numberedSheet ? ' has-numbered-sheet' : ''}${subjectDone ? ' is-done' : ''}${expanded ? '' : ' is-collapsed'}`} key={subject.id}>
          <div className="day-subject-head"><span className="day-subject-icon">{subject.icon}</span><div className="day-subject-title"><h2>{subject.name}</h2></div>
            <button className="day-subject-toggle" type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Свернуть' : 'Развернуть'} ${subject.name}`} onClick={() => setSubjectOpen((current) => ({ ...current, [subject.id]: !expanded }))}><ChevronDown size={19} aria-hidden="true" /></button>
            {expanded && subject.materials && <p className="day-subject-materials">{subject.materials}</p>}
            {(numberedSheet || assignments.multiple || subjectDone || summary) && <div className="day-subject-status">
              {numberedSheet && numberedProblemIds.size ? <span className={`day-subject-assignment-count${numberedDone === numberedProblemIds.size ? ' is-complete' : ''}`} aria-label={`Задачи учителя: ${numberedDone} из ${numberedProblemIds.size} выполнено`}><StatusIcon size={16} status={numberedDone === numberedProblemIds.size ? 'complete' : numberedDone ? 'partial' : 'ready'} />Задачи: {numberedDone} из {numberedProblemIds.size}</span>
                : assignments.multiple && assignments.requiredTotal ? <span className={`day-subject-assignment-count${assignments.complete ? ' is-complete' : ''}`} aria-label={`${assignments.completed} из ${assignments.requiredTotal} обязательных заданий выполнено`}><StatusIcon size={16} status={assignments.complete ? 'complete' : assignments.completed ? 'partial' : 'ready'} />{assignments.completed} из {assignments.requiredTotal}</span>
                : subjectDone && <span className="day-subject-complete" aria-label={`Выполнено ${doneCount} из ${subjectItems.length}`}><StatusIcon status="complete" size={16} />{doneCount} из {subjectItems.length}</span>}
              <GradeBadge summary={summary} details={grade} threshold={page.workingThreshold} asOf={page.gradeAsOf} />
            </div>}</div>
          <div className="day-subject-content" hidden={!expanded}>{!numberedSheet && !['Новое задание МЭШ. Подробный разбор готовится.', 'Точная запись МЭШ. Подробный разбор готовится.'].includes(subject.summary) && <p className="day-subject-summary">{subject.summary}</p>}
            {parent && meshOnlyTasks.length > 0 && <details className="day-mesh"><summary>Как записано в МЭШ</summary>{assignments.multiple ? meshOnlyTasks.map((task) => <p key={task.id}><b>Задание {subject.tasks.indexOf(task) + 1}.</b> {task.meshText ?? task.title}</p>) : <p>{subject.mesh}</p>}</details>}
            <div className="day-task-list">{lineages.map(({ placement, chain }) => {
              const task = subject.tasks.find((item) => item.testToken === placement.token)
              const materialLinks = task ? [...new Map([
                ...(page.materialLinks?.[task.id] ?? []),
                ...(page.taskPageRefs?.[task.id] ?? []).map((ref) => catalogPages[ref]).filter((link): link is DayMaterialLink => Boolean(link)),
              ].map((link) => [link.sourceRef || link.url, link])).values()] : []
              const assignmentIndex = task ? subject.tasks.findIndex((item) => item.id === task.id) : -1
              return <QuizLineageCard key={`lineage-${placement.token}`} chain={chain} parent={parent} task={task} materialLinks={materialLinks} assignmentLabel={assignments.multiple && assignmentIndex >= 0 ? `Задание ${assignmentIndex + 1} из ${assignments.total}` : undefined} separateAssignment={Boolean(task?.problems?.length)} sourceEvidence={sourceEvidence(task)} />
            })}
            {subject.tasks.map((task, assignmentIndex) => {
              // A written task may also have a linked self-check. The test must
              // never replace the notebook submission and its photo action.
              if (!task.problems?.length && (task.kind === 'read' || task.kind === 'check') && task.testToken && lineageByToken.has(task.testToken)) return null
              const taskLinks = [...new Map([
                ...(page.materialLinks?.[task.id] ?? []),
                ...(page.taskPageRefs?.[task.id] ?? []).map((ref) => catalogPages[ref]).filter((link): link is DayMaterialLink => Boolean(link)),
              ].map((link) => [link.sourceRef || link.url, link])).values()]
              const standaloneTest = task.testToken ? tests.find((item) => item.token === task.testToken) : undefined
              if (!task.problems?.length && (task.kind === 'read' || task.kind === 'check') && standaloneTest) return <QuizLineageCard key={task.id} chain={quizChain(standaloneTest, tests)} parent={parent} task={task} materialLinks={taskLinks} assignmentLabel={assignments.multiple ? `Задание ${assignmentIndex + 1} из ${assignments.total}` : undefined} sourceEvidence={sourceEvidence(task)} />
              const readerGroups = groupAdjacentMaterialPages(taskLinks.filter(canReadInside))
              const otherLinks = taskLinks.filter((link) => !canReadInside(link))
              const needsTextbook = task.materialStatus?.state === 'textbook-page-needed' && !taskLinks.some((link) => link.sourceType === 'textbook-page')
              const needsTeacherAttachment = task.materialStatus?.state === 'teacher-attachment-needed' && !taskLinks.some((link) => link.sourceType === 'teacher-attachment')
              const taskUploads = uploads.filter((upload) => uploadMatchesTask(upload, task.id))
              const cdzTask = isCdzTask(task)
              const review = reviews.find((item) => item.taskId === task.id)
              const materialView = materialRequestView(task, taskUploads, review)
              const accepted = parentAccepted(review, parentDecisions.events)
              const familyStageComplete = stageCompletion(review, parentDecisions.events)?.complete ?? false
              const criterionPending = review?.assessmentBasis?.outcome === 'unresolved'
              const familyActions = requiredFamilyActions(review, parentDecisions.events)
              const familyOptional = review?.assessmentBasis?.disputedRequirements?.some((item) => requirementChoice(review, item.id, parentDecisions.events) === 'optional') ?? false
              const processing = activeProcessing(review, taskUploads)
              const taskStatus = familyStageComplete ? 'verified' : criterionPending ? 'unknown' : accepted ? 'verified' : review?.status && review.status !== 'cannot-assess' ? review.status : task.status
              const localTaskPhotos = localPhotos.filter((photo) => photo.taskId === task.id)
              const priorWork = taskUploads.some((upload) => upload.status === 'reviewed')
              const newWork = taskUploads.some((upload) => upload.status === 'pending') || localTaskPhotos.some((photo) => photo.state === 'saved' && !taskUploads.some((upload) => upload.id === `${studentToken}:${photo.id}`))
              const uploadingWork = taskUploads.some((upload) => ['requested', 'awaiting-upload', 'uploaded'].includes(upload.status)) || localTaskPhotos.some((photo) => photo.state === 'uploading')
              const workCovered = workCoverageComplete(review) && !familyActions.length && !newWork && !uploadingWork
              const linkedTest = tests.find((item) => item.token === task.testToken)
              const readPassed = (task.kind === 'read' || task.kind === 'check') && task.testToken && quizRequirement(task.testToken, quizStates, quizScores).state === 'done'
              const referenceDone = Boolean(task.referenceDate && referencedItems.length && referencedItems.every((item) => item.state === 'done'))
              const verified = !materialView && (referenceDone || !task.referenceDate && (taskStatus === 'verified' || readPassed))
              const submitted = (task.kind === 'written' || task.kind === 'check') && newWork
              // @see ../docs/modules/school-diary/dashboard.md#reference-only-homework
              const state = materialView ? materialView.label : task.referenceDate ? referencedItems.length ? `${referenceDone ? 'Готово' : 'Осталось'} · ДЗ за ${dayMonth(task.referenceDate)} · ${referencedItems.filter((item) => item.state === 'done').length} из ${referencedItems.length}` : `См. ДЗ за ${dayMonth(task.referenceDate)}` : task.problems?.length ? `Задачи: ${task.problems.length}` : task.kind === 'written'
                ? taskStatus === 'verified' ? 'Готово · проверено' : processing ? 'Проверяем работу' : newWork ? 'Новое фото · ждёт проверки' : uploadingWork ? 'Фото загружается' : familyActions.length ? 'Доработать по решению родителя' : workCovered ? 'Работа сдана · оценка неясна' : criterionPending ? review?.nextStep ? 'Часть задания не подтверждена · можно добавить фото' : 'Работа разобрана · критерий неясен' : priorWork ? taskStatus === 'needs-fix' ? 'Работа проверена · исправить' : taskStatus === 'partial' ? 'Работа проверена · дополнить' : 'Работа сохранена' : statusLabel(taskStatus)
                : task.kind === 'read' ? task.testToken && quizRequirement(task.testToken, quizStates, quizScores).state === 'optional' ? 'Самопроверка по желанию' : readPassed ? `Чтение подтверждено · ${linkedTest?.points}/${linkedTest?.maxPoints} верно` : linkedTest?.status === 'submitted' ? linkedTest.points == null ? 'Проверяем тест' : `Нужен разбор · ${linkedTest.points}/${linkedTest.maxPoints}` : 'Нужен тест' : cdzTask ? task.platformResult?.state === 'completed' ? cdzResultLabel(task.platformResult) : processing ? 'Проверяем результат ЦДЗ' : newWork ? 'Скриншот ЦДЗ получен · ждёт проверки' : uploadingWork ? 'Скриншот загружается' : 'Нужен скриншот результата ЦДЗ' : statusLabel(taskStatus)
              const uploadLabel = materialView ? newWork || uploadingWork ? 'Добавить ещё фото записей' : 'Добавить фото записей' : cdzTask ? newWork || uploadingWork ? 'Добавить ещё фото ЦДЗ' : 'Загрузить результат ЦДЗ' : newWork || uploadingWork ? 'Добавить ещё фото' : familyActions.length ? 'Загрузить фото доработки' : familyOptional && criterionPending ? 'Добавить фото по желанию' : priorWork ? taskStatus === 'needs-fix' ? 'Добавить фото исправления' : 'Добавить фото продолжения' : 'Загрузить фото тетради'
              // The pupil can always submit a newer photo of written work.
              // A completed review or an unresolved family criterion must not
              // remove the upload control from the pupil's task card.
              const canUpload = pupilCanAddPhoto(task, parent)
              const showSubmission = !materialView && !task.problems?.length && task.kind === 'written' && !verified && (!priorWork || newWork || uploadingWork || criterionPending || taskStatus === 'needs-fix' || taskStatus === 'partial')
              const submission = task.submission
              const renderProblem = (problem: DayProblem) => {
                const problemUploads = uploads.filter((upload) => uploadMatchesTask(upload, problem.id))
                const problemPhotos = localPhotos.filter((photo) => photo.taskId === problem.id)
                const problemReview = reviews.find((item) => item.taskId === problem.id)
                const problemAccepted = parentAccepted(problemReview, parentDecisions.events)
                const state = problemCardState(problemUploads, problemReview, problemPhotos.some((photo) => photo.state === 'uploading'), statusNow, problemAccepted)
                return <ProblemTaskCard problem={problem} state={state} key={problem.id} links={taskLinks} parent={parent} guide={taskGuides[problem.id]?.guide} guidance={guidance.filter((item) => item.taskId === problem.id)} guidanceReady={guidanceReady} onSendGuidance={parent && taskGuides[problem.id]?.guide ? (stage, level) => sendDayGuidance(studentToken, problem.id, taskGuides[problem.id]!.guide!, stage.id, level) : undefined} onStageChoice={parent && helpRole === 'parent' && problemReview && taskGuides[problem.id]?.guide ? (stage, required) => recordStageChoice(problemReview, taskGuides[problem.id]!.guide!, stage.id, required) : undefined} sourceResearch={taskGuides[problem.id]?.sourceResearch} help={helpRequests.find((item) => item.taskId === problem.id)} review={problemReview} uploads={problemUploads} accepted={problemAccepted} canDecide={helpRole === 'parent'} onDecision={parent && canAcceptCorrectAnswer(problemReview) && problemReview ? (action) => recordParentCompletion(problemReview, action) : undefined} decisions={parentDecisions.events} onRequirementChoice={parent && problemReview?.assessmentBasis?.disputedRequirements?.length ? (id, action) => recordRequirementChoice(problemReview, id, action) : undefined} helpAccess={helpRole === 'checking' ? 'checking' : helpRole === 'student' ? 'ready' : 'login-required'} onRequestHelp={!parent && subject.id === 'special' && helpRole === 'student' ? (taskId, revision, kind, text) => requestDayHelp(studentToken, taskId, revision, kind, text) : undefined} onPhotos={(files) => attach(problem, files)}>
                  <PhotoStrip taskTitle={`№ ${problem.number}. ${problem.title}`} studentToken={studentToken} uploads={problemUploads} localPhotos={problemPhotos} review={problemReview} now={statusNow} onRetry={queuePhotoUpload} onDelete={deletePhoto} />
                </ProblemTaskCard>
              }
              const taskCard = <article className={`day-task ${task.problems?.length ? 'has-problems' : ''} ${verified || workCovered ? 'done' : submitted ? 'submitted' : ''}`} id={`day-task-${task.id}`} key={task.id}>
                {assignments.multiple && !task.problems?.length && <div className="day-task-assignment-heading">Задание {assignmentIndex + 1} из {assignments.total}</div>}
                <div className="day-task-row">{!task.problems?.length && <span className={`day-task-state${state.length > 24 ? ' as-text' : ''} ${verified ? 'verified' : workCovered ? 'covered' : submitted ? 'partial' : taskStatus}`}><StatusIcon size={15} status={verified ? 'complete' : uploadingWork ? 'uploading' : processing ? 'processing' : newWork ? 'waiting' : workCovered ? 'unknown' : taskStatus === 'needs-fix' ? 'needs-fix' : taskStatus === 'partial' ? 'partial' : task.kind === 'read' && linkedTest?.answered ? 'started' : taskStatus === 'unknown' && (task.kind === 'read' || cdzTask) ? 'ready' : 'unknown'} />{state}</span>}{task.kind === 'written' && <span className="day-task-type">В тетради</span>}{task.dueDate && task.dueDate !== (task.lessonDate ?? page.targetDate) && <span className="day-task-type">Сдать к {dayMonth(task.dueDate)} · МЭШ</span>}{task.originDate && task.originDate !== page.targetDate && <span className="day-task-type">Осталось с {dayMonth(task.originDate)}</span>}</div>
                {!task.problems?.length && <h3>{task.title}</h3>}{(!task.problems?.length || !readerGroups.some((group) => group[0].sourceType === 'teacher-attachment')) && <AssignmentBrief task={task} materialLinks={taskLinks} compact={Boolean(task.problems?.length)} />}
                {task.referenceDate && referencedItems.length > 0 && <div className="day-reference-results"><strong>Результаты ДЗ за {dayMonth(task.referenceDate)}</strong>{referencedItems.map((item) => <div className="day-reference-result" key={item.id}><span className={item.state === 'done' ? 'complete' : 'pending'}>{item.state === 'done' ? '✓' : '•'} {item.title}</span><small>{item.detail}</small></div>)}</div>}
                {!parent && <TaskGuidance items={guidance.filter((item) => item.taskId === task.id)} />}
                {parent && taskGuides[task.id]?.guide && <ParentTaskGuide guide={taskGuides[task.id]!.guide!} review={review} decisions={parentDecisions.events} guidance={guidance.filter((item) => item.taskId === task.id)} guidanceReady={guidanceReady} onSend={(stage, level) => sendDayGuidance(studentToken, task.id, taskGuides[task.id]!.guide!, stage.id, level)} onStageChoice={helpRole === 'parent' && review ? (stage, required) => recordStageChoice(review, taskGuides[task.id]!.guide!, stage.id, required) : undefined} />}
                {/* @see ../docs/modules/reviews/russian-language-route.md#review-in-one-route the parent route owns its verdict; keep WorkReview for the learner and for parent decisions. */}
                {review?.purpose !== 'source-material' && showSeparateWorkReview(parent, taskGuides[task.id]?.guide?.presentation, canAcceptCorrectAnswer(review), Boolean(review?.assessmentBasis?.disputedRequirements?.length || review?.requirementChecks?.length)) && <WorkReview review={review} uploads={taskUploads} accepted={accepted} canDecide={helpRole === 'parent' && !taskUploads.some((upload) => upload.status === 'pending')} onDecision={parent && canAcceptCorrectAnswer(review) && review ? (action) => recordParentCompletion(review, action) : undefined} decisions={parentDecisions.events} parent={parent} onRequirementChoice={parent && review?.assessmentBasis?.disputedRequirements?.length ? (id, action) => recordRequirementChoice(review, id, action) : undefined} />}
                {familyActions.length > 0 && <div className="day-submission-instructions"><strong>Доработка по решению родителя</strong><ol>{familyActions.map((action) => <li key={action}>{action}</li>)}</ol><p>Это семейное решение по спорному требованию. В МЭШ такого уточнения нет.</p></div>}
                {!!task.steps?.length && <ol className="day-task-steps">{task.steps.map((step, index) => <Instruction key={index} item={step} index={index} />)}</ol>}
                {needsTextbook && <p className="day-material-warning">📖 {task.materialStatus?.message}</p>}
                {needsTeacherAttachment && <p className="day-material-warning">📎 {task.materialStatus?.message}</p>}
                {(task.materialStatus?.state === 'text-absent-from-textbook' || task.materialStatus?.state === 'no-textbook') && <p className="day-material-warning">📖 {task.materialStatus.message}</p>}
                {readerGroups.map((group) => task.problems?.length && group[0].sourceType === 'teacher-attachment'
                  ? <details className="day-teacher-sheet" key={group[0].url}><summary><span>▤ &nbsp;Лист учителя</span><span>{group.length} {group.length === 1 ? 'лист' : 'листа'} · открыть ↗</span></summary><AssignmentBrief task={task} materialLinks={taskLinks} compact /><MaterialReader links={group} parent={parent} statement /></details>
                  : <MaterialReader key={group[0].url} links={group} parent={parent} />)}
                {otherLinks.length > 0 && <div className="day-material-links">{otherLinks.map((material) => <div className="day-material-source" key={material.url}><a href={material.url} target="_blank" rel="noopener noreferrer">{material.sourceType === 'textbook-page' ? 'Страница учебника' : material.sourceType === 'teacher-attachment' ? 'Файл учителя' : material.sourceType === 'external-text' ? 'Внешний текст, не из учебника' : 'Материал'}: {material.title} <ExternalLink size={13} aria-hidden="true" /></a>{material.reason && <small>{material.reason}</small>}{material.sourceQuote && <small>Из учебника: «{material.sourceQuote.trim()}»</small>}{parent && material.sourceRef && <small>{material.sourceRef} · PDF {material.pdfPage} · учебник {material.printedPage}</small>}</div>)}</div>}
                {!!task.problems?.length && <div className="day-problem-list" aria-label={`Задачи: ${task.title}`}>
                  <h4 className="edu-visually-hidden">Задания из листа · {task.problems.length}</h4>
                  {task.practiceVariants?.length ? task.practiceVariants.map((variant) => {
                    const variantProblems = task.problems!.filter((problem) => problem.variantId === variant.id)
                    const completed = variantProblems.filter((problem) => {
                      const review = reviews.find((item) => item.taskId === problem.id)
                      return review?.status === 'verified' || parentAccepted(review, parentDecisions.events)
                    }).length
                    const required = practiceRequired(task, variant.id, parentDecisions.events)
                    return <div className="day-practice-variant-shell" key={variant.id}>
                      <details className="day-practice-variant" open={variantProblems.some((problem) => problem.id === focusTaskId) || undefined}>
                        <summary><strong>{variant.title}</strong><span aria-label={required ? `${completed} из ${variantProblems.length} задач завершено` : 'Вариант по желанию'}>{required && <StatusIcon size={15} status={completed === variantProblems.length ? 'complete' : completed ? 'partial' : 'ready'} />}{required ? `${completed} из ${variantProblems.length}` : 'По желанию'}</span><ChevronDown className="day-practice-variant-chevron" size={17} aria-hidden="true" /></summary>
                        <div className="day-practice-variant-problems">{variantProblems.map(renderProblem)}</div>
                      </details>
                      {parent && <RequirementSwitch checked={required} disabled={!parentDecisions.ready || helpRole !== 'parent'} label={`Учитывать «${variant.title}» в семейном плане`} onChange={(next) => void recordVariantChoice(studentToken, task.id, variant.id, next).catch((cause) => reportUiError(cause, 'Выбор варианта'))} />}
                    </div>
                  }) : task.problems.map(renderProblem)}
                </div>}
                {materialView && task.materialRequest && <MaterialRequest request={task.materialRequest} label={materialView.label} detail={materialView.detail} analysis={review?.sourceAnalysis} />}
                {showSubmission && <div className="day-submission-instructions">
                  <strong>{priorWork && (taskStatus === 'needs-fix' || taskStatus === 'partial') ? 'Что исправить и сфотографировать' : 'Что сфотографировать'}</strong>
                  {submission?.lead && <p>{submission.lead}</p>}
                  {!!submission?.items?.length && <ol>{submission.items.map((item, index) => <Instruction key={index} item={item} index={index} />)}</ol>}
                  {submission?.photo && <p className="day-submission-photo"><b>На фото</b><span>{submission.photo}</span></p>}
                  {!submission?.lead && !submission?.items?.length && !submission?.photo && <p>{submission?.description ?? `Страница тетради с результатом задания «${task.title}». Номер и ответ должны читаться.`}</p>}
                </div>}
                <div className="day-task-actions">
                  {canUpload && <PhotoUploadControl label={uploadLabel} onPhotos={(files) => attach(task, files)} />}
                  {task.kind === 'read' && task.testToken && task.testSlug && <a className="day-quiz-link" href={parent && linkedTest?.status !== 'submitted' && linkedTest?.previewToken ? `#/preview/${task.testSlug}~${linkedTest.previewToken}` : `#/t/${task.testSlug}~${task.testToken}`}>{parent ? linkedTest?.status === 'submitted' ? 'Результат' : 'Посмотреть вопросы' : linkedTest?.status === 'submitted' ? 'Результат' : linkedTest?.answered ? 'Продолжить тест' : 'Пройти короткий тест'} <ExternalLink size={15} /></a>}
                  {parent && !task.problems?.length && <span className="day-parent-status">{materialView ? materialView.label : task.referenceDate ? 'Состояние взято из исходного дня; новой работы МЭШ не назначил' : task.kind === 'written' ? taskStatus === 'verified' ? 'Работа проверена' : newWork ? 'Новая загрузка ожидает проверки' : priorWork ? 'Работа разобрана; подробности выше' : 'Подтверждённого фото пока нет' : task.kind === 'read' ? readPassed ? 'Чтение подтверждено тестом' : 'Чтение тестом пока не подтверждено' : cdzTask ? task.platformResult?.state === 'completed' ? cdzEvidenceLabel(task.platformResult) : newWork ? 'Скриншот ЦДЗ ожидает проверки' : 'Результат ЦДЗ пока не подтверждён' : 'Статус сдачи не сообщён'}</span>}
                </div>
                {!task.referenceDate && <PhotoStrip taskTitle={task.title} evidenceLabel={task.materialRequest ? 'Материал для уточнения' : cdzTask ? 'Подтверждение ЦДЗ' : 'Фото работы'} studentToken={studentToken} uploads={taskUploads} localPhotos={localTaskPhotos} review={review} now={statusNow} onRetry={queuePhotoUpload} onDelete={deletePhoto} />}
                {parent && <small className="day-source"><BookOpen size={14} /> {task.source}</small>}
              </article>
              if (!task.problems?.length) return taskCard
              /** @see ../docs/modules/school-diary/day-page.md#completed-problem-group */
              const requiredProblems = task.practiceVariants?.length ? task.problems.filter((problem) =>
                problem.variantId && practiceRequired(task, problem.variantId, parentDecisions.events)) : task.problems
              const problemIds = new Set(requiredProblems.map((problem) => problem.id))
              const localPendingCount = localPhotos.filter((photo) => problemIds.has(photo.taskId) && !uploads.some((upload) => upload.id === `${studentToken}:${photo.id}` && upload.status === 'reviewed')).length
              const sourceCount = new Set(taskLinks.filter((link) => link.sourceType === 'teacher-attachment').map((link) => link.url)).size
              const teacherChoice = task.practiceVariants?.length && task.practiceVariants.every(variant => variant.optionalByTeacher)
              return <ProblemGroup key={task.id} id={task.id} title={task.practiceVariants?.length ? assignmentTitle(task, assignmentIndex, assignments.total).replace(/^Подготовиться к (?:самостоятельной|контрольной)(?: работе)?:/i, 'Подготовка:') : assignmentTitle(task, assignmentIndex, assignments.total)} subtitle={teacherChoice ? 'Реши сколько получится · по выбору учителя' : task.practiceVariants?.length ? `${task.practiceVariants.length} варианта из листа учителя` : undefined} problems={task.problems} requiredProblems={requiredProblems} numberLabel={teacherChoice ? `${task.problems.length} задач по выбору` : task.practiceVariants?.length ? `${task.practiceVariants.length} варианта` : undefined} uploads={uploads} reviews={reviews} decisions={parentDecisions.events} localPendingCount={localPendingCount} sourceCount={sourceCount} ready={evidenceReady && parentDecisions.ready} focusTaskId={focusTaskId}>{taskCard}</ProblemGroup>
            })}
            {currentPlacements.filter((placement) => placement.subjectId === subject.id && !placement.taskId).map((placement) => {
              const test = tests.find((item) => item.token === placement.token)
              const chain = lineageByToken.get(placement.token)
              if (chain) return null
              return test ? <QuizCard key={placement.token} chain={quizChain(test, tests)} parent={parent} id={`day-quiz-${placement.token}`} /> : <p key={placement.token} className="day-loading">Загружаем тест…</p>
            })}</div>
          </div>
        </section>
      })}</div>
      {noSpecialHomework && <p className="day-no-homework">Спецкурс по математике: в МЭШ на {dayMonth(page.targetDate)} домашнее задание не указано.</p>}
    </>}
    <footer className="day-footer"><Clock3 size={15} /> МЭШ: снимок {new Date(page.meshFetchedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}. Работы и тесты обновляются при открытой странице.</footer>
  </div></>
}
