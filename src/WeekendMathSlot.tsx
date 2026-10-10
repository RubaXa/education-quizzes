import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CheckCircle2, Clock3, LoaderCircle, X } from 'lucide-react'
import { removePendingDayPhoto, requestDayHelp, uploadDayPhoto, watchDayHelp, watchDayPage, watchDayReviews, watchDayUploads } from '@/lib/dayStore'
import type { DayHelp, DayPageData, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { reviewHeadline } from '@/lib/reviewPresentation'
import { dayHelpSessionRole } from '@/lib/personalAccess'
import PublicThumbnail from '@/components/PublicThumbnail'
import ProblemStatement from '@/components/ProblemStatement'
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
    const saved = local.filter((item) => uploads.some((upload) => upload.id === `${studentToken}:${item.id}`))
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
      void uploadDayPhoto(studentToken, taskId, file, id).catch((cause) => {
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
    {subjects.map((subject) => subject.tasks.filter((task) => task.problems?.length).map((task) => <div className="weekend-math-group" key={task.id}>
      <h3>{subject.icon} {subject.name}</h3>
      <p>{subject.id === 'special' ? 'Реши сколько получится. Предлагаемый путь Education: № 2, 6, 5, затем № 1 или 4; № 3 и 7 — если останется время.' : 'Все четыре номера указаны учителем. Предлагаемый путь Education: № 3 → 4, затем № 6 → 7.'}</p>
      <div className="weekend-math-problems">{task.problems?.map((problem) => {
        const photos = uploads.filter((upload) => upload.taskId === problem.id)
        const previews = local.filter((item) => item.taskId === problem.id && !photos.some((upload) => upload.id === `${studentToken}:${item.id}`))
        const review = reviews.find((item) => item.taskId === problem.id)
        const pending = photos.some((photo) => photo.status === 'pending')
        const status = pending ? 'Ждёт проверки' : review?.status ? reviewHeadline(review) : photos.length ? 'Фото загружено' : 'Пока не загружено'
        return <article className="weekend-math-problem" key={problem.id}>
          <div className="weekend-math-problem-head"><strong>№ {problem.number}. {problem.title}</strong><span className={review?.status === 'verified' && !pending ? 'verified' : ''}>{pending ? <Clock3 size={13} /> : review?.status === 'verified' ? <CheckCircle2 size={13} /> : null}{status}</span></div>
          <ProblemStatement problem={problem} links={page.materialLinks?.[task.id] ?? []} parent={parent} help={helpRequests.find((item) => item.taskId === problem.id)} review={review} helpAccess={helpRole === 'checking' ? 'checking' : helpRole === 'student' ? 'ready' : 'login-required'} onRequestHelp={!parent && helpRole === 'student' ? (taskId, revision) => requestDayHelp(studentToken, taskId, revision) : undefined} />
          {review?.status && <div className={`weekend-math-feedback ${review.status}`}><strong>{reviewHeadline(review)}</strong>{review.mathReasoning && <div className="weekend-math-reasoning"><p><b>Ответ:</b> {review.mathReasoning.answer === 'correct' ? 'верен' : review.mathReasoning.answer === 'incorrect' ? 'есть ошибка' : 'пока не установлен'}</p><p><b>Ход:</b> {review.mathReasoning.argument === 'sufficient' ? 'достаточен' : review.mathReasoning.argument === 'incomplete' ? 'нужен переход' : review.mathReasoning.argument === 'not-shown' ? 'не показан' : review.mathReasoning.argument === 'not-required' ? 'не требовался' : 'не читается'}</p><p><b>На фото:</b> {review.mathReasoning.observed}</p>{review.mathReasoning.minimumNeeded && <p><b>Что добавить:</b> {review.mathReasoning.minimumNeeded}</p>}</div>}{review.nextStep && <p>{review.status === 'verified' ? 'Что дальше' : 'Подсказка к следующей попытке'}: {review.nextStep}</p>}{!!review.history?.length && <small>Предыдущих попыток: {review.history.length}</small>}</div>}
          <div className="weekend-math-actions">{!parent && <label><Camera size={16} /> {review?.status === 'needs-fix' || review?.status === 'partial' ? 'Загрузить исправление' : 'Загрузить материал'}<input type="file" accept="image/*" multiple onChange={(event) => { addPhotos(problem.id, Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} /></label>}{parent && !photos.length && <small>Фото ещё нет</small>}</div>
          {(photos.length > 0 || previews.length > 0) && <div className="weekend-math-photos" aria-label={`Фото задачи № ${problem.number}`}>
            {photos.map((photo, index) => <span key={photo.id} title={photo.status === 'reviewed' ? 'Фото проверено' : 'Ждёт проверки'}>{photo.dataUrl ? <img src={photo.dataUrl} alt={`Фото ${index + 1}`} /> : photo.storage?.publicUrl ? <PublicThumbnail url={photo.storage.publicUrl} alt={`Фото ${index + 1}`} fallback={<Camera size={15} />} /> : <Camera size={15} />}{photo.status === 'reviewed' ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}{!parent && photo.status === 'pending' && <button type="button" aria-label={`Удалить фото ${index + 1}`} onClick={() => { void removePendingDayPhoto(photo.id.split(':')[0], photo.id.split(':')[1]).catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось удалить фото.')) }}><X size={11} /></button>}</span>)}
            {previews.map((photo) => <span key={photo.id} title={photo.error ?? 'Загружается'}><img src={photo.url} alt="Новое фото" />{photo.state === 'failed' ? '!' : <LoaderCircle size={12} className="spinning" />}</span>)}
          </div>}
          {previews.some((photo) => photo.state === 'failed') && <small className="weekend-math-error">Фото не загрузилось. Выберите его ещё раз.</small>}
        </article>
      })}</div>
    </div>))}
  </section>
}
