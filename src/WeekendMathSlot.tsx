import TaskWorkEvidence from '@/components/TaskWorkEvidence'
import { workFileContentType } from '../storage/work-file-types.mjs'
/* @see ../docs/decisions/weekend-parent-actions-2026-10-18.md */
/* @see ../docs/decisions/work-photo-expand-2026-10-18.md */
/* @see ../docs/decisions/upload-origin-links-2026-10-18.md */
/* @see ../docs/decisions/photo-upload-authorization-and-freshness-2026-10-20.md */
import { useEffect, useRef, useState } from 'react'
import { removePendingDayPhoto, requestDayHelp, uploadDayPhoto, uploadMatchesTask, watchDayHelp, watchDayPage, watchDayTaskGuides } from '@/lib/dayStore'
import type { DayHelp, DayPageData, ParentTaskPrivate } from '@/lib/dayStore'
import { dayHelpSessionRole } from '@/lib/personalAccess'
import { useTaskGuidance } from '@/lib/useTaskGuidance'
import MaterialReader, { canReadInside } from '@/components/MaterialReader'
import ProblemGroup from '@/components/ProblemGroup'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import { taskUploadPresentation } from '@/lib/taskUploadPresentation'
import { problemCardState } from '@/lib/reviewPresentation'
import { useDayEvidence } from '@/lib/useDayEvidence'
import { useParentCompletions } from '@/lib/useParentCompletions'
import { canAcceptCorrectAnswer, parentAccepted, practiceRequired, recordParentCompletion, recordRequirementChoice, recordStageChoice } from '@/lib/parentCompletion'
import { reportUiError } from '@/lib/uiErrors'
import './WeekendMathSlot.css'

type LocalPhoto = { originalName?: string; contentType?: string; id: string; taskId: string; url: string; state: 'uploading' | 'failed'; error?: string }
function shortDate(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }

export default function WeekendMathSlot({ token, taskIds, parent, lessonDate, dueDate, title }: { token: string; taskIds: string[]; parent: boolean; lessonDate?: string; dueDate: string; title: string }) {
  const [page, setPage] = useState<DayPageData>()
  const [helpRequests, setHelpRequests] = useState<DayHelp[]>([])
  const [guideSnapshot, setGuideSnapshot] = useState<{ token: string; guides: Record<string, ParentTaskPrivate> }>({ token: '', guides: {} })
  const [helpRole, setHelpRole] = useState<'checking' | 'student' | 'parent' | 'none'>('checking')
  const [local, setLocal] = useState<LocalPhoto[]>([])
  const previewUrls = useRef(new Set<string>())
  const [error, setError] = useState('')
  const { studentToken, evidenceKey, uploads, reviews, evidencePages, ready: evidenceReady } = useDayEvidence(page, token, setError)
  const guidance = useTaskGuidance(studentToken, helpRole, setError)
  const taskPrivate = parent && helpRole === 'parent' && guideSnapshot.token === studentToken ? guideSnapshot.guides : {}
  const parentDecisions = useParentCompletions(evidenceKey, Boolean(page) && helpRole !== 'checking' && helpRole !== 'none')
  const [statusNow, setStatusNow] = useState(() => Date.now())
  useEffect(() => watchDayPage(token, (data) => { setPage(data); setError('') }, (cause) => setError(reportUiError(cause, 'Задание на выходные'))), [token])
  useEffect(() => {
    let active = true
    if (!page) return
    void dayHelpSessionRole({ familyId: page.familyId, childId: page.childId }).then((role) => { if (active) setHelpRole(role ?? 'none') })
    return () => { active = false }
  }, [page])
  useEffect(() => page && helpRole !== 'checking' && helpRole !== 'none' ? watchDayHelp(evidenceKey.split('|'), setHelpRequests, (cause) => {
    if ((cause as Error & { code?: string }).code === 'permission-denied') { setHelpRole('none'); setHelpRequests([]) }
    else setError(reportUiError(cause, 'Задание на выходные'))
  }) : undefined, [page, evidenceKey, helpRole])
  useEffect(() => {
    if (!parent || !page || !studentToken || helpRole !== 'parent') return
    return watchDayTaskGuides(studentToken, (guides) => setGuideSnapshot({ token: studentToken, guides }), (cause) => {
      setGuideSnapshot({ token: '', guides: {} })
      if ((cause as Error & { code?: string }).code === 'permission-denied') setHelpRole('none')
      setError(reportUiError(cause, 'Ориентиры для проверки'))
    })
  }, [parent, page, studentToken, helpRole])
  useEffect(() => {
    const saved = local.filter((item) => uploads.some((upload) => upload.id === `${studentToken}:${item.id}` && (upload.status === 'pending' || upload.status === 'reviewed')))
    if (!saved.length) return
    saved.forEach((item) => { URL.revokeObjectURL(item.url); previewUrls.current.delete(item.url) })
    setLocal((current) => current.filter((item) => !saved.includes(item)))
  }, [local, uploads, studentToken])
  useEffect(() => () => { for (const url of previewUrls.current) URL.revokeObjectURL(url) }, [])
  const hasPendingUploads = uploads.some((upload) => upload.status === 'pending')
  useEffect(() => {
    if (!hasPendingUploads) return
    const timer = window.setInterval(() => setStatusNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [hasPendingUploads])

  function addPhotos(taskId: string, files: File[]) {
    for (const file of files) {
      const id = crypto.randomUUID()
      const url = URL.createObjectURL(file)
      previewUrls.current.add(url)
      setLocal((current) => [...current, { id, taskId, url, originalName: file.name, contentType: workFileContentType(file), state: 'uploading' }])
      void uploadDayPhoto(studentToken, taskId, file, id, page).catch((cause) => {
        reportUiError(cause, 'Загрузка фото')
        setLocal((current) => current.map((item) => item.id === id ? { ...item, state: 'failed', error: cause instanceof Error ? cause.message : 'Файл не загрузился.' } : item))
      })
    }
  }

  if (error && !page) return <section className="weekend-math-slot" role="alert">Не удалось загрузить математический слот: {error}</section>
  if (!page) return <section className="weekend-math-slot">Загружаем задания на выходные…</section>
  const requested = new Set(taskIds)
  const subjects = page.subjects.map((subject) => ({ ...subject, tasks: subject.tasks.filter((task) => requested.has(task.id)) })).filter((subject) => subject.tasks.length)
  if (subjects.flatMap((subject) => subject.tasks).length !== requested.size) return <section className="weekend-math-slot" role="alert">Связь выходного задания изменилась. Обновляем карточку; сохранённые работы остаются в подробном ДЗ.</section>
  return <section className="weekend-math-slot" aria-label={title}>
    <header><div><span className="weekend-math-kicker">Работа на субботу и воскресенье</span><h2>{title}</h2><p>{subjects.map((subject) => subject.name).join(' · ')} · урок {shortDate(lessonDate || page.targetDate)} · сдать {shortDate(dueDate)}</p></div></header>
    {error && <p className="weekend-math-error" role="alert">{error}</p>}
    {subjects.map((subject) => subject.tasks.filter((task) => task.problems?.length).map((task) => {
      const taskLinks = page.materialLinks?.[task.id] ?? []
      const teacherLinks = taskLinks.filter((link) => link.sourceType === 'teacher-attachment' && canReadInside(link))
      const problems = task.problems ?? []
      // @see ../docs/modules/school-diary/dashboard.md#weekend-work-contract
      // The weekend is a projection of the same task and family choices.
      const requiredProblems = problems.filter((problem) => !problem.variantId || practiceRequired(task, problem.variantId, parentDecisions.events))
      const teacherChoice = task.practiceVariants?.some((variant) => variant.optionalByTeacher)
      const problemIds = new Set(problems.map((problem) => problem.id))
      const localPendingCount = local.filter((photo) => problemIds.has(photo.taskId) && !uploads.some((upload) => upload.id === `${studentToken}:${photo.id}` && upload.status === 'reviewed')).length
      const sourceCount = new Set(taskLinks.filter((link) => link.sourceType === 'teacher-attachment').map((link) => link.url)).size
      /** @see ../docs/modules/school-diary/day-page.md#completed-problem-group
       * @see ../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet */
      return <ProblemGroup key={task.id} id={task.id} title={`${subject.icon} ${subject.name}`} subtitle={teacherChoice && !requiredProblems.length ? 'Реши сколько получится · по выбору учителя' : undefined} problems={problems} requiredProblems={requiredProblems} numberLabel={teacherChoice ? `Задачи по выбору · ${problems.length}` : undefined} uploads={uploads} reviews={reviews} decisions={parentDecisions.events} localPendingCount={localPendingCount} sourceCount={sourceCount} ready={evidenceReady && parentDecisions.ready}>
      <div className="weekend-math-group">
      <p>{subject.summary || task.detail}</p>
      {teacherLinks.length > 0 && <details className="day-teacher-sheet"><summary><span>▤ &nbsp;Лист учителя</span><span>{teacherLinks.length} {teacherLinks.length === 1 ? 'лист' : 'листа'} · открыть ↗</span></summary><MaterialReader links={teacherLinks} parent={parent} statement /></details>}
      <h4 className="weekend-math-list-title edu-visually-hidden">Задания из листа · {task.problems?.length}</h4>
      <div className="weekend-math-problems">{task.problems?.map((problem) => {
        const photos = uploads.filter((upload) => uploadMatchesTask(upload, problem.id))
        const ownPhotos = taskUploadPresentation(uploads, problem.id).owned
        const previews = local.filter((item) => item.taskId === problem.id && !ownPhotos.some((upload) => upload.id === `${studentToken}:${item.id}`))
        const review = reviews.find((item) => item.taskId === problem.id)
        const accepted = parentAccepted(review, parentDecisions.events)
        const state = problemCardState(photos, review, previews.some((photo) => photo.state === 'uploading'), statusNow, accepted)
        return <ProblemTaskCard studentToken={studentToken} owner={{ familyId: page.familyId, childId: page.childId }} problem={problem} state={state} key={problem.id} links={taskLinks} parent={parent} guide={taskPrivate[problem.id]?.guide} {...guidance.forTask(problem.id, taskPrivate[problem.id]?.guide)} onStageChoice={parent && helpRole === 'parent' && review && taskPrivate[problem.id]?.guide ? (stage, required) => recordStageChoice(review, taskPrivate[problem.id]!.guide!, stage.id, required) : undefined} sourceResearch={taskPrivate[problem.id]?.sourceResearch} help={helpRequests.find((item) => item.taskId === problem.id)} review={review} uploads={photos} accepted={accepted} canDecide={helpRole === 'parent'} onDecision={parent && canAcceptCorrectAnswer(review) && review ? (action) => recordParentCompletion(review, action) : undefined} decisions={parentDecisions.events} onRequirementChoice={parent && review?.assessmentBasis?.disputedRequirements?.length ? (id, action) => recordRequirementChoice(review, id, action) : undefined} helpAccess={helpRole === 'checking' ? 'checking' : helpRole === 'student' ? 'ready' : 'login-required'} onRequestHelp={!parent && helpRole === 'student' ? async (taskId, revision, kind, text) => { await requestDayHelp(studentToken, taskId, revision, kind, text) } : undefined} onPhotos={(files) => addPhotos(problem.id, files)}>
          <TaskWorkEvidence layout="weekend" taskId={problem.id} taskTitle={`№ ${problem.number}. ${problem.title}`} studentToken={studentToken} uploads={uploads} localPhotos={previews.map((photo) => ({ ...photo, previewUrl: photo.url }))} review={review} now={statusNow} pages={[page, ...(evidencePages ?? [])]} onDelete={!parent ? (qualifiedId) => { const [sourceToken, photoId] = qualifiedId.split(':'); return removePendingDayPhoto(sourceToken, photoId) } : undefined} />
          {previews.some((photo) => photo.state === 'failed') && <small className="weekend-math-error">Файл не загрузился. Выберите его ещё раз.</small>}
        </ProblemTaskCard>
      })}</div>
    </div></ProblemGroup>
    }))}
  </section>
}
