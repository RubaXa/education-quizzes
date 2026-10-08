import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Camera, CheckCircle2, ChevronDown, Clock3, ExternalLink } from 'lucide-react'
import { uploadDayPhoto, watchDayPage, watchDayUploads, watchMaterialPages } from '@/lib/dayStore'
import type { DayMaterialLink, DayPageData, DayTask, DayUpload } from '@/lib/dayStore'
import { loadAnswerKey, watchAssignment, watchDashboard } from '@/lib/store'
import { grade } from '@/lib/quiz'
import type { Assignment } from '@/lib/quiz'
import MaterialReader, { canReadInside } from '@/components/MaterialReader'
import { publicImage } from '@/lib/yandexPublic'
import './DayPage.css'

type TestItem = { token: string; title: string; subject: string; slug: string; status: Assignment['status']; answered: number; total: number; points?: number; maxPoints?: number }

/**
 * Показывает работу из временной очереди или по ссылке на проверенный файл Диска.
 * @see ../docs/product/day-page.md#photo-preview
 * @see ../docs/product/storage-privacy.md#upload-queue
 */
function WorkPhoto({ upload, title, index }: { upload: DayUpload; title: string; index: number }) {
  const [src, setSrc] = useState(upload.dataUrl ?? '')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (upload.dataUrl) { setSrc(upload.dataUrl); setFailed(false); return }
    const url = upload.storage?.publicUrl
    if (!url) { setSrc(''); return }
    let active = true
    setSrc('')
    setFailed(false)
    void publicImage(url).then((image) => { if (active) setSrc(image) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [upload.dataUrl, upload.storage?.publicUrl])
  if (failed || !src) return upload.storage?.publicUrl
    ? <p><a href={upload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть фото на Яндекс.Диске</a></p>
    : <p>Фото ожидает переноса на Яндекс.Диск.</p>
  return <img src={src} alt={`Работа по заданию «${title}», фото ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

/**
 * Показывает живое состояние связанного теста внутри домашнего задания.
 * @see ../docs/product/day-page.md#test-progress
 */
function TestProgress({ test }: { test: TestItem }) {
  const answered = Math.min(test.answered, test.total)
  const remaining = Math.max(0, test.total - answered)
  const label = test.status === 'submitted'
    ? `Отправлен · ${answered} из ${test.total} вопросов с ответом`
    : answered ? `В процессе · осталось ${remaining} из ${test.total} вопросов`
      : `Тест не начат · осталось ${remaining} из ${test.total} вопросов`
  return <div className="day-test-progress">
    <span>{label}</span>
    <div className="day-test-track" role="progressbar" aria-label="Ответы на вопросы теста" aria-valuemin={0} aria-valuemax={test.total} aria-valuenow={answered}>
      <span style={{ width: `${test.total ? answered / test.total * 100 : 0}%` }} />
    </div>
  </div>
}

function shortDate(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }
function dayMonth(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }
function fives(count: number) { return count === 1 ? 'пятёрка' : count >= 2 && count <= 4 ? 'пятёрки' : 'пятёрок' }
function formatAverage(value: number) { return value.toFixed(2).replace('.', ',') }
function formatChange(value: number) { return `${value >= 0 ? '+' : '−'}${formatAverage(Math.abs(value))}` }
function localMinutes() { const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Moscow' }).format(new Date()).split(':').map(Number); return parts[0] * 60 + parts[1] }
/** @see ../docs/product/day-page.md#day-page */
function activeView(page: DayPageData): 'homework' | 'school' {
  const last = page.todaySchedule.map((lesson) => lesson.end).sort().at(-1)
  if (!last) return 'homework'
  const [hour, minute] = last.split(':').map(Number)
  return localMinutes() < hour * 60 + minute ? 'school' : 'homework'
}
function statusLabel(status: DayTask['status']) { return ({ verified: 'Проверено', 'needs-fix': 'Нужно исправить', partial: 'Часть сделана', unknown: 'Статус неизвестен' })[status] }
/** @see ../docs/product/grades.md#grade-badge */
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
 * @see ../docs/product/grades.md#grade-badge
 */
function GradeBadge({ summary, details, threshold, asOf }: { summary?: GradeSummary; details?: GradeDetails; threshold?: number; asOf?: string }) {
  const [open, setOpen] = useState(false)
  const [nextMark, setNextMark] = useState(4)
  const [nextWeight, setNextWeight] = useState(1)
  if (!summary) return null
  const excellent = isExcellent(summary)
  if (excellent) return <span className="day-grade excellent">🌟 5,00 · супер</span>
  if (!needsAttention(summary)) return <span className="day-grade">{formatAverage(summary.average)} · запас есть</span>
  const reliable = canForecast(summary, details) && threshold != null && threshold > 0 && threshold < 5
  const result = reliable ? forecast(details!.grades, nextMark, nextWeight, threshold!) : null
  return <>
    <button type="button" className="day-grade watch day-grade-button" aria-expanded={open} aria-label={`Средний по предмету ${formatAverage(summary.average)}. ${open ? 'Скрыть' : 'Показать'} сценарий следующей оценки`} onClick={() => setOpen((value) => !value)}><span>{formatAverage(summary.average)}</span><ChevronDown size={14} aria-hidden="true" /></button>
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
 * @see ../docs/product/day-page.md#day-page
 * @see ../docs/product/access-and-state.md#state
 */
export default function DayPage({ token, parent }: { token: string; parent: boolean }) {
  /** @see ../docs/product/dashboard.md#day-navigation */
  const [requestedView] = useState(() => {
    const query = new URLSearchParams(window.location.search).get('tab')
    const stored = sessionStorage.getItem('education-day-initial-tab')
    sessionStorage.removeItem('education-day-initial-tab')
    return query ?? stored
  })
  const [returnToDashboard] = useState(() => {
    const saved = sessionStorage.getItem('education-day-dashboard-return') ?? ''
    return new RegExp(`^#/${parent ? 'days-parent' : 'days'}/[A-Za-z0-9_-]{20,}$`).test(saved) ? saved : ''
  })
  const [page, setPage] = useState<DayPageData>()
  const [catalogPages, setCatalogPages] = useState<Record<string, DayMaterialLink>>({})
  const [uploads, setUploads] = useState<DayUpload[]>([])
  const [tests, setTests] = useState<TestItem[]>([])
  const [view, setView] = useState<'homework' | 'school'>(requestedView === 'homework' ? 'homework' : 'school')
  const [manualView, setManualView] = useState(requestedView === 'homework' || requestedView === 'school')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let active = true
    let stops: (() => void)[] = []
    let connected = false
    stops.push(watchDayPage(token, (data) => {
      if (!active) return
      if ((parent && data.kind !== 'parent') || (!parent && data.kind !== 'student')) { setError('Эта ссылка предназначена для другой страницы.'); return }
      setPage(data)
      if (connected) return
      connected = true
      let generation = 0
      let assignmentStops: (() => void)[] = []
      stops.push(watchDashboard(data.boardToken, (index) => {
        generation += 1
        const current = generation
        assignmentStops.forEach((stop) => stop())
        assignmentStops = []
        const rows = new Map<string, TestItem>()
        if (!index.length) setTests([])
        for (const item of index) {
          const stop = watchAssignment(item.token, (assignment) => {
            if (!active || generation !== current) return
            rows.set(item.token, {
              token: item.token, title: item.title, subject: item.subject, slug: item.slug,
              status: assignment.status, answered: Object.values(assignment.answers ?? {}).filter((answer) => answer !== '' && (!Array.isArray(answer) || answer.length > 0)).length,
              total: assignment.questions.length,
            })
            const show = () => setTests([...rows.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'ru')))
            show()
            if (assignment.status === 'submitted') {
              void loadAnswerKey(item.token).then((key) => {
                if (!active || generation !== current) return
                const results = grade(assignment, key)
                rows.set(item.token, { ...rows.get(item.token)!, points: results.reduce((sum, result) => sum + (result.points ?? 0), 0), maxPoints: assignment.questions.reduce((sum, question) => sum + question.points, 0) })
                show()
              }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось получить результат теста.'))
            }
          }, (cause) => setError(cause.message))
          assignmentStops.push(stop)
        }
      }, (cause) => setError(cause.message)))
      stops.push(() => assignmentStops.forEach((stop) => stop()))
    }, (cause) => { if (active) setError(cause.message) }))
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [token, parent])
  useEffect(() => {
    const refs = Object.values(page?.taskPageRefs ?? {}).flat()
    if (!refs.length) return
    return watchMaterialPages(refs, setCatalogPages, () => {
      // Legacy day links remain available while a device reconnects to its family session.
    })
  }, [page?.taskPageRefs])

  const studentToken = page?.studentToken ?? token
  const evidenceTokens = [...new Set([studentToken, ...(page?.evidenceDayTokens || [])])].join('|')
  const hasPage = Boolean(page)
  useEffect(() => {
    if (!hasPage) return
    return watchDayUploads(evidenceTokens.split('|'), setUploads, (cause) => setError(cause.message))
  }, [evidenceTokens, hasPage])
  useEffect(() => {
    if (!page || manualView) return
    const update = () => setView(activeView(page))
    update()
    const timer = window.setInterval(update, 60_000)
    return () => window.clearInterval(timer)
  }, [page, manualView])
  const currentPlacements = useMemo(() => (page?.testPlacements ?? []).filter((placement) => (placement.originDate ?? page?.targetDate) === page?.targetDate), [page])
  const dayTests = useMemo(() => currentPlacements.map((placement) => tests.find((item) => item.token === placement.token)).filter((item): item is TestItem => Boolean(item)), [currentPlacements, tests])
  const pending = useMemo(() => {
    if (!page) return 0
    const taskPending = page.subjects.flatMap((subject) => subject.tasks).filter((task) => (task.originDate ?? page.targetDate) === page.targetDate).filter((task) => {
      if (task.status === 'verified') return false
      if (task.kind === 'written') return !uploads.some((upload) => upload.taskId === task.id && (upload.status === 'pending' || task.status === 'unknown'))
      if (task.kind === 'read') { const test = tests.find((item) => item.token === task.testToken); return !(test?.status === 'submitted' && test.points != null && test.points >= (task.requiredPoints ?? test.maxPoints ?? 1)) }
      return true
    }).length
    const testPending = currentPlacements.filter((placement) => !placement.taskId && tests.find((item) => item.token === placement.token)?.status !== 'submitted').length
    return taskPending + testPending
  }, [page, uploads, tests, currentPlacements])
  async function attach(task: DayTask, files: FileList | null) {
    if (!files?.length) return
    setBusy(task.id)
    try {
      for (const file of Array.from(files)) await uploadDayPhoto(studentToken, task.id, file)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить фото.') }
    finally { setBusy('') }
  }

  if (error && !page) return <div className="day-error"><h1>Не получилось открыть страницу</h1><p>{error}</p></div>
  if (!page) return <p className="day-loading">Загружаем страницу дня…</p>
  const currentSubjects = page.subjects.map((subject) => ({ ...subject, tasks: subject.tasks.filter((task) => (task.originDate ?? page.targetDate) === page.targetDate) }))
    .filter((subject) => subject.tasks.length || currentPlacements.some((placement) => placement.subjectId === subject.id && !placement.taskId))
  const noSpecialHomework = page.targetSchedule.some((lesson) => /Спецкурс|Специальный курс/i.test(lesson.subject))
    && !currentSubjects.some((subject) => subject.id === 'special')
  const currentTaskIds = new Set(currentSubjects.flatMap((subject) => subject.tasks.map((task) => task.id)))
  const lastChange = page.changes?.[0]
  const currentAdded = lastChange?.added.filter((id) => currentTaskIds.has(id)) ?? []
  const currentChanged = lastChange?.changed.filter((id) => currentTaskIds.has(id)) ?? []

  return <div className={`day-page ${parent ? 'day-parent' : 'day-student'}`}>
    {returnToDashboard && <a className="day-return" href={returnToDashboard}>← Назад к dashboard</a>}
    <section className="day-hero">
      <div className="day-kicker">{parent ? 'Панель родителя' : 'Мой план'} · {shortDate(page.date)}</div>
      <h1>{parent ? 'Что требует внимания' : 'Сегодня справимся 👋'}</h1>
      <p>{parent ? `Домашнее задание к ${dayMonth(page.targetDate)}: только назначения на эту дату. Выполненные заранее работы появятся у соответствующих заданий.` : `Домашнее задание к ${dayMonth(page.targetDate)}. Выполненное заранее уже будет видно у своего задания.`}</p>
      <div className="day-summary"><strong>{pending}</strong><span>{pending === 1 ? 'действие к этой дате осталось' : 'действий к этой дате осталось'}</span>{currentPlacements.length > 0 && <><span className="day-summary-separator">·</span><span>{dayTests.filter((test) => test.status === 'submitted').length} из {currentPlacements.length} тестов завершено</span></>}</div>
    </section>

    <div className="day-tabs" role="tablist" aria-label="Раздел страницы дня">
      <button role="tab" aria-selected={view === 'school'} className={view === 'school' ? 'active' : ''} onClick={() => { setManualView(true); setView('school') }}>Расписание</button>
      <button role="tab" aria-selected={view === 'homework'} className={view === 'homework' ? 'active' : ''} onClick={() => { setManualView(true); setView('homework') }}>Домашнее задание на {dayMonth(page.targetDate)}</button>
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
      <h3>Завтра в школе</h3>
      <div className="day-next-schedule">{page.targetSchedule.map((lesson, index) => <span key={`${lesson.start}-${index}`}>{lesson.start} {lesson.subject}</span>)}</div>
    </section> : <>
      {parent && page.parentNotes?.[0] && <section className="day-attention"><h2>ДЗ на {dayMonth(page.targetDate)}</h2><p>{page.parentNotes[0]}</p></section>}
      {parent && (currentAdded.length > 0 || currentChanged.length > 0) && <section className="day-attention"><h2>Изменения ДЗ на {dayMonth(page.targetDate)}</h2><p>Добавлено действий: {currentAdded.length}. Уточнено: {currentChanged.length}.</p></section>}
      {page.notices[0] && !parent && <div className="day-notices"><p>✳ {page.notices[0]}</p></div>}
      <h2 className="day-homework-heading">Домашнее задание на {dayMonth(page.targetDate)}</h2>
      {currentSubjects.length === 0 && <div className="day-notices"><p>На эту дату задания в МЭШ пока не указаны.</p></div>}

      <div className="day-subject-list">{currentSubjects.map((subject) => {
        const summary = page.gradeSummary.find((item) => item.id === subject.id)
        const grade = page.grades?.find((item) => item.id === subject.id)
        return <section className={`day-subject day-subject-${subject.id}`} key={subject.id}>
          <div className="day-subject-head"><span className="day-subject-icon">{subject.icon}</span><div className="day-subject-title"><h2>{subject.name}</h2><p>{subject.materials}</p></div>
            <GradeBadge summary={summary} details={grade} threshold={page.workingThreshold} asOf={page.gradeAsOf} /></div>
          <div className="day-subject-content"><p className="day-subject-summary">{subject.summary}</p>
            {parent && <details className="day-mesh"><summary>Как записано в МЭШ</summary><p>{subject.mesh}</p></details>}
            <div className="day-task-list">{subject.tasks.map((task) => {
              const taskLinks = [...new Map([
                ...(page.materialLinks?.[task.id] ?? []),
                ...(page.taskPageRefs?.[task.id] ?? []).map((ref) => catalogPages[ref]).filter((link): link is DayMaterialLink => Boolean(link)),
              ].map((link) => [link.sourceRef || link.url, link])).values()]
              const readerGroups = taskLinks.filter(canReadInside).reduce<DayMaterialLink[][]>((groups, link) => {
                const key = `${link.sourceType}:${link.title.replace(/,\s*стр\.\s*\d+\s*$/, '')}`
                const existing = groups.find((group) => `${group[0].sourceType}:${group[0].title.replace(/,\s*стр\.\s*\d+\s*$/, '')}` === key)
                if (existing) existing.push(link)
                else groups.push([link])
                return groups
              }, [])
              const otherLinks = taskLinks.filter((link) => !canReadInside(link))
              const needsTextbook = task.materialStatus?.state === 'textbook-page-needed' && !taskLinks.some((link) => link.sourceType === 'textbook-page')
              const taskUploads = uploads.filter((upload) => upload.taskId === task.id)
              const priorWork = taskUploads.some((upload) => upload.status === 'reviewed')
              const newWork = taskUploads.some((upload) => upload.status === 'pending')
              const linkedTest = tests.find((item) => item.token === task.testToken)
              const readPassed = task.kind === 'read' && linkedTest?.status === 'submitted' && linkedTest.points != null && linkedTest.points >= (task.requiredPoints ?? linkedTest.maxPoints ?? 1)
              const verified = task.status === 'verified' || readPassed
              const submitted = task.kind === 'written' && newWork
              const state = task.kind === 'written'
                ? task.status === 'verified' ? 'Готово · проверено' : newWork ? 'Новое фото · ждёт проверки' : priorWork ? task.status === 'needs-fix' ? 'Работа проверена · исправить' : task.status === 'partial' ? 'Работа проверена · дополнить' : 'Работа сохранена' : statusLabel(task.status)
                : task.kind === 'read' ? readPassed ? `Тест пройден · ${linkedTest?.points}/${linkedTest?.maxPoints}` : linkedTest?.status === 'submitted' ? linkedTest.points == null ? 'Проверяем тест' : `Нужен разбор · ${linkedTest.points}/${linkedTest.maxPoints}` : 'Нужен тест' : statusLabel(task.status)
              const uploadLabel = newWork ? 'Добавить ещё фото ответа' : priorWork ? task.status === 'needs-fix' ? 'Сфотографировать исправление' : 'Сфотографировать продолжение' : task.submission?.buttonLabel ?? 'Сфотографировать ответ'
              const canUpload = !parent && task.kind === 'written' && task.status !== 'verified' && (!priorWork || newWork || task.status === 'needs-fix' || task.status === 'partial')
              const showSubmission = task.kind === 'written' && task.status !== 'verified' && (!priorWork || newWork || task.status === 'needs-fix' || task.status === 'partial')
              const submission = task.submission
              return <article className={`day-task ${verified ? 'done' : submitted ? 'submitted' : ''}`} key={task.id}>
                <div className="day-task-row"><span className={`day-task-state ${verified ? 'verified' : submitted ? 'partial' : task.status}`}>{verified && <CheckCircle2 size={15} aria-hidden="true" />} {state}</span>{task.kind === 'written' && <span className="day-task-type">В тетради</span>}{task.originDate && task.originDate !== page.targetDate && <span className="day-task-type">Осталось с {dayMonth(task.originDate)}</span>}</div>
                <h3>{task.title}</h3><p>{task.detail}</p>
                {!!task.steps?.length && <ol className="day-task-steps">{task.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
                {needsTextbook && <p className="day-material-warning">📖 {task.materialStatus?.message}</p>}
                {(task.materialStatus?.state === 'text-absent-from-textbook' || task.materialStatus?.state === 'no-textbook') && <p className="day-material-warning">📖 {task.materialStatus.message}</p>}
                {readerGroups.map((group) => <MaterialReader key={group[0].url} links={group} parent={parent} />)}
                {otherLinks.length > 0 && <div className="day-material-links">{otherLinks.map((material) => <div className="day-material-source" key={material.url}><a href={material.url} target="_blank" rel="noopener noreferrer">{material.sourceType === 'textbook-page' ? 'Страница учебника' : material.sourceType === 'teacher-attachment' ? 'Файл учителя' : material.sourceType === 'external-text' ? 'Внешний текст, не из учебника' : 'Материал'}: {material.title} <ExternalLink size={13} aria-hidden="true" /></a>{material.reason && <small>{material.reason}</small>}{material.sourceQuote && <small>Из учебника: «{material.sourceQuote.trim()}»</small>}{parent && material.sourceRef && <small>{material.sourceRef} · PDF {material.pdfPage} · учебник {material.printedPage}</small>}</div>)}</div>}
                {showSubmission && <div className="day-submission-instructions">
                  <strong>{priorWork && (task.status === 'needs-fix' || task.status === 'partial') ? 'Что исправить и сфотографировать' : 'Что сфотографировать'}</strong>
                  {submission?.lead && <p>{submission.lead}</p>}
                  {!!submission?.items?.length && <ol>{submission.items.map((item, index) => <li key={index}>{item}</li>)}</ol>}
                  {submission?.photo && <p className="day-submission-photo"><b>На фото</b><span>{submission.photo}</span></p>}
                  {!submission?.lead && !submission?.items?.length && !submission?.photo && <p>{submission?.description ?? `Страница тетради с результатом задания «${task.title}». Номер и ответ должны читаться.`}</p>}
                </div>}
                <div className="day-task-actions">
                  {canUpload && <label className="day-upload"><Camera size={17} /> {busy === task.id ? 'Загружаем…' : uploadLabel}<input type="file" accept="image/*" capture="environment" multiple disabled={busy === task.id} onChange={(event) => { void attach(task, event.target.files); event.target.value = '' }} /></label>}
                  {task.kind === 'read' && task.testToken && task.testSlug && <a className="day-quiz-link" href={`#/t/${task.testSlug}~${task.testToken}`}>{parent ? linkedTest?.status === 'submitted' ? 'Посмотреть результат' : 'Открыть тест' : linkedTest?.status === 'submitted' ? 'Посмотреть результат' : linkedTest?.answered ? 'Продолжить тест' : 'Пройти короткий тест'} <ExternalLink size={15} /></a>}
                  {parent && <span className="day-parent-status">{task.kind === 'written' ? task.status === 'verified' ? 'Работа проверена' : newWork ? 'Новая загрузка ожидает проверки' : priorWork ? 'Исходная работа получена и разобрана; осталось действие выше' : 'Подтверждённого фото пока нет' : task.kind === 'read' ? readPassed ? 'Чтение подтверждено тестом' : 'Чтение тестом пока не подтверждено' : 'Статус сдачи не сообщён'}</span>}
                </div>
                {task.kind === 'read' && linkedTest && <TestProgress test={linkedTest} />}
                {taskUploads.length > 0 && <div className="day-upload-list">{taskUploads.map((upload, index) => <details className="day-upload-proof" key={upload.id}><summary>{upload.origin === 'archive' ? `Ранее загруженная работа${upload.recordedDate ? ` · ${upload.recordedDate.slice(8, 10)}.${upload.recordedDate.slice(5, 7)}` : ''}` : `Фото ${index + 1}`} · {upload.status === 'pending' ? 'ожидает разбора' : 'проверено'} · {upload.storage?.state === 'stored' ? 'на Яндекс.Диске' : 'ожидает переноса на Диск'}</summary><WorkPhoto upload={upload} title={task.title} index={index} />{upload.storage?.publicUrl && <a className="day-upload-original" href={upload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>}</details>)}</div>}
                {parent && <small className="day-source"><BookOpen size={14} /> {task.source}</small>}
              </article>
            })}
            {currentPlacements.filter((placement) => placement.subjectId === subject.id && !placement.taskId).map((placement) => {
              const test = tests.find((item) => item.token === placement.token)
              return <article className={`day-task day-quiz-task ${test?.status === 'submitted' ? 'done' : ''}`} key={placement.token}>
                <div className="day-task-row"><span className={`day-task-state ${test?.status === 'submitted' ? 'verified' : ''}`}>{test?.status === 'submitted' ? 'Тест завершён' : test?.answered ? 'Тест в процессе' : 'Тест не пройден'}</span><span className="day-task-type">Самопроверка</span></div>
                <h3>{test?.title ?? 'Загружаем тест…'}</h3>
                {test && <><TestProgress test={test} /><a className="day-quiz-link" href={`#/t/${test.slug}~${test.token}`}>{parent ? test.status === 'submitted' ? 'Посмотреть результат' : 'Открыть тест' : test.status === 'submitted' ? 'Мой результат' : test.answered ? 'Продолжить тест' : 'Пройти тест'} <ExternalLink size={15} /></a></>}
              </article>
            })}</div>
          </div>
        </section>
      })}</div>
      {noSpecialHomework && <p className="day-no-homework">Спецкурс по математике: в МЭШ на {dayMonth(page.targetDate)} домашнее задание не указано.</p>}
    </>}
    <footer className="day-footer"><Clock3 size={15} /> МЭШ: снимок {new Date(page.meshFetchedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}. Работы и тесты обновляются при открытой странице.</footer>
  </div>
}
