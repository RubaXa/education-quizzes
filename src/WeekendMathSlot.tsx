import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { removePendingDayPhoto, requestDayHelp, uploadDayPhoto, uploadMatchesTask, watchDayHelp, watchDayPage, watchDayTaskGuides } from '@/lib/dayStore'
import type { DayHelp, DayPageData, ParentTaskPrivate } from '@/lib/dayStore'
import { dayHelpSessionRole } from '@/lib/personalAccess'
import EducationImage from '@/components/EducationImage'
import ArtifactAvatar, { WorkArtifactImage } from '@/components/ArtifactAvatar'
import MaterialReader, { canReadInside } from '@/components/MaterialReader'
import ProblemGroup from '@/components/ProblemGroup'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import { artifactAvatarLabel, artifactAvatarState, localArtifactAvatarState, problemCardState } from '@/lib/reviewPresentation'
import { useDayEvidence } from '@/lib/useDayEvidence'
import { useParentCompletions } from '@/lib/useParentCompletions'
import { canAcceptCorrectAnswer, parentAccepted, recordParentCompletion, recordRequirementChoice } from '@/lib/parentCompletion'
import { reportUiError } from '@/lib/uiErrors'
import './WeekendMathSlot.css'

type LocalPhoto = { id: string; taskId: string; url: string; state: 'uploading' | 'failed'; error?: string }
function shortDate(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }

export default function WeekendMathSlot({ token, taskIds, parent, lessonDate, dueDate, title }: { token: string; taskIds: string[]; parent: boolean; lessonDate?: string; dueDate: string; title: string }) {
  const [page, setPage] = useState<DayPageData>()
  const [helpRequests, setHelpRequests] = useState<DayHelp[]>([])
  const [guideSnapshot, setGuideSnapshot] = useState<{ token: string; guides: Record<string, ParentTaskPrivate> }>({ token: '', guides: {} })
  const [helpRole, setHelpRole] = useState<'checking' | 'student' | 'parent' | 'none'>('checking')
  const [local, setLocal] = useState<LocalPhoto[]>([])
  const previewUrls = useRef(new Set<string>())
  const [error, setError] = useState('')
  const { studentToken, evidenceKey, uploads, reviews, ready: evidenceReady } = useDayEvidence(page, token, setError)
  const taskPrivate = parent && helpRole === 'parent' && guideSnapshot.token === studentToken ? guideSnapshot.guides : {}
  const parentDecisions = useParentCompletions(evidenceKey, Boolean(page) && helpRole !== 'checking' && helpRole !== 'none')
  const [statusNow, setStatusNow] = useState(() => Date.now())
  useEffect(() => watchDayPage(token, (data) => { setPage(data); setError('') }, (cause) => setError(reportUiError(cause, 'Задание на выходные'))), [token])
  useEffect(() => {
    let active = true
    void dayHelpSessionRole().then((role) => { if (active) setHelpRole(role ?? 'none') })
    return () => { active = false }
  }, [])
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
      setLocal((current) => [...current, { id, taskId, url, state: 'uploading' }])
      void uploadDayPhoto(studentToken, taskId, file, id, page?.planRevision).catch((cause) => {
        reportUiError(cause, 'Загрузка фото')
        setLocal((current) => current.map((item) => item.id === id ? { ...item, state: 'failed', error: cause instanceof Error ? cause.message : 'Фото не загрузилось.' } : item))
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
      const problemIds = new Set(problems.map((problem) => problem.id))
      const localPendingCount = local.filter((photo) => problemIds.has(photo.taskId) && !uploads.some((upload) => upload.id === `${studentToken}:${photo.id}` && upload.status === 'reviewed')).length
      const sourceCount = new Set(taskLinks.filter((link) => link.sourceType === 'teacher-attachment').map((link) => link.url)).size
      /** @see ../docs/product/day-page.md#completed-problem-group */
      return <ProblemGroup key={task.id} id={task.id} title={`${subject.icon} ${subject.name}`} problems={problems} uploads={uploads} reviews={reviews} decisions={parentDecisions.events} localPendingCount={localPendingCount} sourceCount={sourceCount} ready={evidenceReady && parentDecisions.ready}>
      <div className="weekend-math-group">
      <p>{subject.summary || task.detail}</p>
      {teacherLinks.length > 0 && <MaterialReader links={teacherLinks} parent={parent} statement />}
      <h4 className="weekend-math-list-title">Задания из листа · {task.problems?.length}</h4>
      <div className="weekend-math-problems">{task.problems?.map((problem) => {
        const photos = uploads.filter((upload) => uploadMatchesTask(upload, problem.id))
        const previews = local.filter((item) => item.taskId === problem.id && !photos.some((upload) => upload.id === `${studentToken}:${item.id}`))
        const review = reviews.find((item) => item.taskId === problem.id)
        const accepted = parentAccepted(review, parentDecisions.events)
        const state = problemCardState(photos, review, previews.some((photo) => photo.state === 'uploading'), statusNow, accepted)
        return <ProblemTaskCard problem={problem} state={state} key={problem.id} links={taskLinks} parent={parent} guide={taskPrivate[problem.id]?.guide} sourceResearch={taskPrivate[problem.id]?.sourceResearch} help={helpRequests.find((item) => item.taskId === problem.id)} review={review} uploads={photos} accepted={accepted} canDecide={helpRole === 'parent'} onDecision={parent && canAcceptCorrectAnswer(review) && review ? (action) => recordParentCompletion(review, action) : undefined} decisions={parentDecisions.events} onRequirementChoice={parent && review?.assessmentBasis?.disputedRequirements?.length ? (id, action) => recordRequirementChoice(review, id, action) : undefined} helpAccess={helpRole === 'checking' ? 'checking' : helpRole === 'student' ? 'ready' : 'login-required'} onRequestHelp={!parent && helpRole === 'student' ? (taskId, revision, kind, text) => requestDayHelp(studentToken, taskId, revision, kind, text) : undefined} onPhotos={(files) => addPhotos(problem.id, files)}>
          {(photos.length > 0 || previews.length > 0) && <div className="weekend-math-photos" aria-label={`Фото задачи № ${problem.number}`}>
            {photos.map((photo, index) => {
              const localPhoto = local.find((item) => photo.id === `${studentToken}:${item.id}`)
              const state = artifactAvatarState(photo, review, statusNow)
              return <span className="weekend-math-photo-item" key={photo.id} title={`Фото ${index + 1} · ${artifactAvatarLabel(state)}`}>
                <ArtifactAvatar state={state}><WorkArtifactImage upload={photo} title={problem.title} index={index} fallbackUrl={localPhoto?.url} compact retryControl /></ArtifactAvatar>
                {!parent && photo.status !== 'reviewed' && <button type="button" aria-label={`Удалить фото ${index + 1}`} onClick={() => { void removePendingDayPhoto(photo.id.split(':')[0], photo.id.split(':')[1]).catch((cause) => setError(reportUiError(cause, 'Удаление фото'))) }}><X size={11} /></button>}
              </span>
            })}
            {previews.map((photo) => <span className="weekend-math-photo-item" key={photo.id} title={photo.error ?? artifactAvatarLabel(localArtifactAvatarState(photo.state))}><ArtifactAvatar state={localArtifactAvatarState(photo.state)}><EducationImage source={photo.url} alt="Новое фото" compact /></ArtifactAvatar></span>)}
          </div>}
          {previews.some((photo) => photo.state === 'failed') && <small className="weekend-math-error">Фото не загрузилось. Выберите его ещё раз.</small>}
        </ProblemTaskCard>
      })}</div>
    </div></ProblemGroup>
    }))}
  </section>
}
