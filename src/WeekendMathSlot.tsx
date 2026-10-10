import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CheckCircle2, Clock3, LoaderCircle, X } from 'lucide-react'
import { removePendingDayPhoto, requestDayHelp, uploadDayPhoto, watchDayHelp, watchDayPage, watchDayReviews, watchDayUploads } from '@/lib/dayStore'
import type { DayHelp, DayPageData, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { dayHelpSessionRole } from '@/lib/personalAccess'
import PublicThumbnail from '@/components/PublicThumbnail'
import ProblemStatement from '@/components/ProblemStatement'
import MaterialReader, { canReadInside } from '@/components/MaterialReader'
import WorkReview from '@/components/WorkReview'
import { ProblemCard, ProblemUploadButton } from '@/components/ProblemCard'
import { problemCardState } from '@/lib/reviewPresentation'
import './WeekendMathSlot.css'

type LocalPhoto = { id: string; taskId: string; url: string; state: 'uploading' | 'failed'; error?: string }

export default function WeekendMathSlot({ token, parent, dueDate, title }: { token: string; parent: boolean; dueDate: string; title: string }) {
  const [page, setPage] = useState<DayPageData>()
  const [uploads, setUploads] = useState<DayUpload[]>([])
  const [reviews, setReviews] = useState<DayWorkReview[]>([])
  const [helpRequests, setHelpRequests] = useState<DayHelp[]>([])
  const [helpRole, setHelpRole] = useState<'checking' | 'student' | 'parent' | 'none'>('checking')
  const [local, setLocal] = useState<LocalPhoto[]>([])
  const previewUrls = useRef(new Set<string>())
  const [error, setError] = useState('')
  const studentToken = page?.studentToken ?? token
  const evidenceTokens = useMemo(() => [...new Set([studentToken, ...(page?.evidenceDayTokens ?? [])])], [studentToken, page])
  useEffect(() => watchDayPage(token, (data) => { setPage(data); setError('') }, (cause) => setError(cause.message)), [token])
  useEffect(() => page ? watchDayUploads(evidenceTokens, setUploads, (cause) => setError(cause.message)) : undefined, [page, evidenceTokens])
  useEffect(() => page ? watchDayReviews(evidenceTokens, setReviews, (cause) => setError(cause.message)) : undefined, [page, evidenceTokens])
  useEffect(() => {
    let active = true
    void dayHelpSessionRole().then((role) => { if (active) setHelpRole(role ?? 'none') })
    return () => { active = false }
  }, [])
  useEffect(() => page && helpRole !== 'checking' && helpRole !== 'none' ? watchDayHelp(evidenceTokens, setHelpRequests, (cause) => {
    if ((cause as Error & { code?: string }).code === 'permission-denied') { setHelpRole('none'); setHelpRequests([]) }
    else setError(cause.message)
  }) : undefined, [page, evidenceTokens, helpRole])
  useEffect(() => {
    const saved = local.filter((item) => uploads.some((upload) => upload.id === `${studentToken}:${item.id}` && (upload.status === 'pending' || upload.status === 'reviewed')))
    if (!saved.length) return
    saved.forEach((item) => { URL.revokeObjectURL(item.url); previewUrls.current.delete(item.url) })
    setLocal((current) => current.filter((item) => !saved.includes(item)))
  }, [local, uploads, studentToken])
  useEffect(() => () => { for (const url of previewUrls.current) URL.revokeObjectURL(url) }, [])

  function addPhotos(taskId: string, files: File[]) {
    for (const file of files) {
      const id = crypto.randomUUID()
      const url = URL.createObjectURL(file)
      previewUrls.current.add(url)
      setLocal((current) => [...current, { id, taskId, url, state: 'uploading' }])
      void uploadDayPhoto(studentToken, taskId, file, id, page?.planRevision).catch((cause) => {
        setLocal((current) => current.map((item) => item.id === id ? { ...item, state: 'failed', error: cause instanceof Error ? cause.message : 'Фото не загрузилось.' } : item))
      })
    }
  }

  if (error && !page) return <section className="weekend-math-slot" role="alert">Не удалось загрузить математический слот: {error}</section>
  if (!page) return <section className="weekend-math-slot">Загружаем задания на выходные…</section>
  const subjects = page.subjects.filter((subject) => (subject.id === 'math' || subject.id === 'special') && subject.tasks.some((task) => task.problems?.length))
  return <section className="weekend-math-slot" aria-label="Математика на выходных">
    <header><div><span className="weekend-math-kicker">Один слот на субботу и воскресенье</span><h2>{title}</h2><p>Спецкурс и геометрия · срок сдачи {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${dueDate}T12:00:00+03:00`))}</p></div></header>
    {error && <p className="weekend-math-error" role="alert">{error}</p>}
    {subjects.map((subject) => subject.tasks.filter((task) => task.problems?.length).map((task) => {
      const taskLinks = page.materialLinks?.[task.id] ?? []
      const teacherLinks = taskLinks.filter((link) => link.sourceType === 'teacher-attachment' && canReadInside(link))
      return <div className="weekend-math-group" key={task.id}>
      <h3>{subject.icon} {subject.name}</h3>
      <p>{subject.id === 'special' ? 'Реши сколько получится. Предлагаемый путь Education: № 2, 6, 5, затем № 1 или 4; № 3 и 7 — если останется время.' : 'Все четыре номера указаны учителем. Предлагаемый путь Education: № 3 → 4, затем № 6 → 7.'}</p>
      {teacherLinks.length > 0 && <MaterialReader links={teacherLinks} parent={parent} statement />}
      <h4 className="weekend-math-list-title">Задания из листа · {task.problems?.length}</h4>
      <div className="weekend-math-problems">{task.problems?.map((problem) => {
        const photos = uploads.filter((upload) => upload.taskId === problem.id)
        const previews = local.filter((item) => item.taskId === problem.id && !photos.some((upload) => upload.id === `${studentToken}:${item.id}`))
        const review = reviews.find((item) => item.taskId === problem.id)
        const state = problemCardState(photos, review, previews.some((photo) => photo.state === 'uploading'))
        return <ProblemCard problem={problem} state={state} key={problem.id}>
          <ProblemStatement problem={problem} links={taskLinks} parent={parent} help={helpRequests.find((item) => item.taskId === problem.id)} review={review} helpAccess={helpRole === 'checking' ? 'checking' : helpRole === 'student' ? 'ready' : 'login-required'} onRequestHelp={!parent && helpRole === 'student' ? (taskId, revision) => requestDayHelp(studentToken, taskId, revision) : undefined} />
          <WorkReview review={review} uploads={photos} />
          <div className="problem-card-actions">{!parent && <ProblemUploadButton correction={review?.status === 'needs-fix' || review?.status === 'partial'} onPhotos={(files) => addPhotos(problem.id, files)} />}{parent && !photos.length && <small>Фото ещё нет</small>}</div>
          {(photos.length > 0 || previews.length > 0) && <div className="weekend-math-photos" aria-label={`Фото задачи № ${problem.number}`}>
            {photos.map((photo, index) => { const localPhoto = local.find((item) => photo.id === `${studentToken}:${item.id}`); return <span key={photo.id} title={photo.status === 'reviewed' ? 'Фото проверено' : photo.status === 'pending' ? 'Ждёт проверки' : 'Передаём на Яндекс.Диск'}>{photo.dataUrl ? <img src={photo.dataUrl} alt={`Фото ${index + 1}`} /> : photo.storage?.publicUrl ? <PublicThumbnail url={photo.storage.publicUrl} alt={`Фото ${index + 1}`} fallback={<Camera size={15} />} /> : localPhoto ? <img src={localPhoto.url} alt={`Фото ${index + 1}`} /> : <Camera size={15} />}{photo.status === 'reviewed' ? <CheckCircle2 size={12} /> : photo.status === 'pending' ? <Clock3 size={12} /> : <LoaderCircle size={12} className="spinning" />}{!parent && photo.status !== 'reviewed' && <button type="button" aria-label={`Удалить фото ${index + 1}`} onClick={() => { void removePendingDayPhoto(photo.id.split(':')[0], photo.id.split(':')[1]).catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось удалить фото.')) }}><X size={11} /></button>}</span> })}
            {previews.map((photo) => <span key={photo.id} title={photo.error ?? 'Загружается'}><img src={photo.url} alt="Новое фото" />{photo.state === 'failed' ? '!' : <LoaderCircle size={12} className="spinning" />}</span>)}
          </div>}
          {previews.some((photo) => photo.state === 'failed') && <small className="weekend-math-error">Фото не загрузилось. Выберите его ещё раз.</small>}
        </ProblemCard>
      })}</div>
    </div>
    }))}
  </section>
}
