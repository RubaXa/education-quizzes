import { useEffect, useMemo, useRef, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronDown, Clock3, Sparkles } from 'lucide-react'
import { watchDayPage, watchDayReviews, watchDayUploads, watchEvidenceDayPages, withVerifiedPlatformResult } from '@/lib/dayStore'
import type { DayPageData, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { useParentCompletions } from '@/lib/useParentCompletions'
import { watchDayDashboard } from '@/lib/dayDashboardStore'
import type { DayDashboardData } from '@/lib/dayDashboardStore'
import { loadAnswerKey, watchAssignment } from '@/lib/store'
import { grade } from '@/lib/quiz'
import type { Assignment } from '@/lib/quiz'
import { lessonSubjectId, lessonWorkItems } from '@/lib/homeworkStatus'
import type { LessonWorkItem, QuizScore } from '@/lib/homeworkStatus'
import { currentEducationPersonId } from '@/lib/personalAccess'
import WeekendMathSlot from './WeekendMathSlot'
import './DayDashboard.css'
import { reportUiError } from '@/lib/uiErrors'

function moscowToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`))
}
function checkedLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(value)) : 'ещё не проверяли'
}
function word(count: number, one: string, few: string, many: string) {
  const n = count % 100
  if (n >= 11 && n <= 14) return many
  return count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many
}
function isWeekend(date: string) { return [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) }
function lessonTime(iso: string) {
  if (!iso) return ''
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(time)
}
/**
 * Домашний обзор берёт календарь из dayDashboards, а детали из того же dayPages,
 * что и страница дня. Ответы тестов и фото читаются из их живых документов.
 * @see ../docs/product/dashboard.md#firestore-model
 * @see ../docs/product/dashboard.md#day-navigation
 * @see ../docs/product/grades.md#dashboard-grade-list
 */
/** @see ../docs/product/design-system.md#cards-and-status */
export default function DayDashboard({ token, parent }: { token: string; parent: boolean }) {
  let personalParent = false
  if (parent) {
    try { personalParent = Boolean(currentEducationPersonId()) } catch { /* Legacy calendar links can still open without a personal session. */ }
  }
  const [index, setIndex] = useState<DayDashboardData>()
  const [page, setPage] = useState<DayPageData>()
  const [gradePage, setGradePage] = useState<DayPageData>()
  const [uploads, setUploads] = useState<DayUpload[]>([])
  const [reviews, setReviews] = useState<DayWorkReview[]>([])
  const [evidencePages, setEvidencePages] = useState<DayPageData[]>([])
  const [tests, setTests] = useState<Record<string, Assignment>>({})
  const [scores, setScores] = useState<Record<string, QuizScore>>({})
  const [selected, setSelected] = useState(() => sessionStorage.getItem('education-dashboard-selection-day') === moscowToday() ? (sessionStorage.getItem('education-dashboard-selected-date') ?? moscowToday()) : moscowToday())
  const [focusSubject, setFocusSubject] = useState(() => sessionStorage.getItem('education-dashboard-focus-subject') ?? '')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const datesRef = useRef<HTMLDivElement>(null)
  const today = moscowToday()

  useEffect(() => {
    const navigate = () => {
      const date = sessionStorage.getItem('education-dashboard-selected-date')
      if (date) setSelected(date)
      setFocusSubject(sessionStorage.getItem('education-dashboard-focus-subject') ?? '')
    }
    window.addEventListener('education-notification-navigation', navigate)
    return () => window.removeEventListener('education-notification-navigation', navigate)
  }, [])

  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    void getAuth().authStateReady().then(() => {
      if (!active) return
      if (!getAuth().currentUser) { setError('Откройте свою личную ссылку Education.'); return }
      stop = watchDayDashboard(token, (data) => {
        if (data.kind !== (parent ? 'parent' : 'student')) { setError('Эта ссылка предназначена для другой страницы.'); return }
        setIndex(data)
        setError('')
      }, (cause) => setError(reportUiError(cause, 'Учебный день')))
    }).catch((cause) => { if (active) setError(reportUiError(cause, 'Учебный день')) })
    return () => { active = false; stop?.() }
  }, [token, parent])

  const selectedDate = index?.days.some((day) => day.date === selected) ? selected : index?.days.find((day) => day.date === today)?.date ?? index?.days.filter((day) => day.date < today).at(-1)?.date ?? index?.days[0]?.date ?? today
  const selectedEntry = index?.days.find((day) => day.date === selectedDate)
  useEffect(() => {
    if (!focusSubject || !selectedEntry) return
    const subjectId = lessonSubjectId(focusSubject)
    const target = [...document.querySelectorAll<HTMLElement>('.day-dashboard-lesson')].find((element) => element.dataset.subject === focusSubject || subjectId != null && lessonSubjectId(element.dataset.subject ?? '') === subjectId)
    if (target) {
      if (target instanceof HTMLDetailsElement) target.open = true
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      sessionStorage.removeItem('education-dashboard-focus-subject')
      setFocusSubject('')
    }
  }, [focusSubject, selectedEntry])
  useEffect(() => {
    const strip = datesRef.current
    const active = strip?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (strip && active) strip.scrollLeft = active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.clientWidth) / 2
  }, [index, selectedDate])
  const homeworkToken = selectedEntry?.homeworkDayToken
  const gradeToken = index?.days.filter((day) => day.date <= today && day.dayToken).sort((a, b) => b.date.localeCompare(a.date))[0]?.dayToken
  useEffect(() => {
    setPage(undefined)
    if (!homeworkToken) return
    return watchDayPage(homeworkToken, setPage, (cause) => setError(reportUiError(cause, 'Учебный день')))
  }, [homeworkToken])
  useEffect(() => {
    setGradePage(undefined)
    if (!gradeToken) return
    return watchDayPage(gradeToken, setGradePage, (cause) => setError(reportUiError(cause, 'Учебный день')))
  }, [gradeToken])
  const selectedPage = page?.targetDate === selectedDate ? page : undefined
  useEffect(() => {
    const taskId = sessionStorage.getItem('education-dashboard-focus-task')
    if (!taskId || !selectedPage || !homeworkToken) return
    sessionStorage.removeItem('education-dashboard-focus-task')
    sessionStorage.setItem('education-day-dashboard-return', `#/${parent ? 'days-parent' : 'days'}/${token}`)
    sessionStorage.setItem('education-day-initial-tab', 'homework')
    sessionStorage.setItem('education-day-focus-task', JSON.stringify({ dayToken: homeworkToken, taskId }))
    window.location.hash = `#/${parent ? 'day-parent' : 'day'}/${homeworkToken}`
  }, [selectedPage, homeworkToken, parent, token])
  const studentToken = selectedPage ? (selectedPage.studentToken ?? homeworkToken) : undefined
  const evidenceTokens = useMemo(() => [...new Set([studentToken, ...(selectedPage?.evidenceDayTokens ?? [])].filter((value): value is string => Boolean(value)))], [studentToken, selectedPage])
  const evidenceKey = evidenceTokens.join('|')
  const parentDecisions = useParentCompletions(evidenceKey, Boolean(selectedPage))
  useEffect(() => {
    if (!reviews.some((review) => review.processing)) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [reviews])
  useEffect(() => {
    setUploads([])
    if (!evidenceKey) return
    return watchDayUploads(evidenceKey.split('|'), setUploads, (cause) => setError(reportUiError(cause, 'Учебный день')))
  }, [evidenceKey])
  useEffect(() => {
    setReviews([])
    if (!evidenceKey) return
    return watchDayReviews(evidenceKey.split('|'), setReviews, (cause) => setError(reportUiError(cause, 'Учебный день')), parent)
  }, [evidenceKey, parent])
  useEffect(() => {
    setEvidencePages([])
    if (!evidenceKey) return
    return watchEvidenceDayPages(evidenceKey.split('|'), setEvidencePages, (cause) => setError(reportUiError(cause, 'Учебный день')))
  }, [evidenceKey])
  const placementKey = (selectedPage?.testPlacements ?? []).filter((placement) => (placement.originDate ?? selectedDate) === selectedDate).map((placement) => placement.token).join('|')
  useEffect(() => {
    setTests({})
    setScores({})
    if (!placementKey) return
    let active = true
    const stops = placementKey.split('|').map((testToken) => watchAssignment(testToken, (assignment) => {
      setTests((prior) => ({ ...prior, [testToken]: assignment }))
      if (assignment.status !== 'submitted') return
      void loadAnswerKey(testToken).then((key) => {
        if (!active) return
        const results = grade(assignment, key)
        if (results.some((result) => result.points == null)) return
        setScores((prior) => ({ ...prior, [testToken]: { points: results.reduce((sum, result) => sum + (result.points ?? 0), 0), maxPoints: assignment.questions.reduce((sum, question) => sum + question.points, 0) } }))
      }).catch((cause) => setError(reportUiError(cause, 'Учебный день')))
    }, (cause) => setError(reportUiError(cause, 'Учебный день'))))
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [placementKey])

  const weekendWorks = index?.weekendWork?.filter((slot) => slot.dates.includes(selectedDate)) ?? []
  const currentSubjects = selectedPage?.subjects.map((subject) => ({ ...subject, tasks: subject.tasks.filter((task) => (task.originDate ?? selectedDate) === selectedDate)
    .map((task) => withVerifiedPlatformResult(task, selectedDate, evidencePages)) })).filter((subject) => subject.tasks.length) ?? []
  const homeworkRows = currentSubjects.map((subject) => {
    const items = lessonWorkItems(subject.tasks, uploads, reviews, parentDecisions.events, tests, scores)
    const done = items.filter((item) => item.state === 'done').length
    const next = items.find((item) => item.state === 'todo') ?? items.find((item) => item.state === 'checking') ?? items.find((item) => item.state === 'unclear')
    const group = items.some((item) => item.state === 'todo') ? 'action' : items.some((item) => item.state === 'checking' || item.state === 'unclear') ? 'waiting' : 'complete'
    return { subject, items, done, next, group }
  })
  const actionRows = homeworkRows.filter((row) => row.group === 'action')
  const waitingRows = homeworkRows.filter((row) => row.group === 'waiting')
  const completeRows = homeworkRows.filter((row) => row.group === 'complete')
  const gradeSource = gradePage
  const gradeRows = gradeSource?.gradeSummary ?? []
  const gradeDetails = new Map((gradeSource?.grades ?? []).map((item) => [item.id, item]))

  function chooseDay(date: string) {
    setSelected(date)
    setFocusSubject('')
    sessionStorage.removeItem('education-dashboard-focus-subject')
    sessionStorage.setItem('education-dashboard-selected-date', date)
    sessionStorage.setItem('education-dashboard-selection-day', today)
  }
  function openDay(dayToken: string, tab?: 'homework', taskId?: string) {
    sessionStorage.setItem('education-day-dashboard-return', `#/${parent ? 'days-parent' : 'days'}/${token}`)
    if (tab) sessionStorage.setItem('education-day-initial-tab', tab)
    else sessionStorage.removeItem('education-day-initial-tab')
    if (taskId) sessionStorage.setItem('education-day-focus-task', JSON.stringify({ dayToken, taskId }))
    else sessionStorage.removeItem('education-day-focus-task')
    window.location.hash = `#/${parent ? 'day-parent' : 'day'}/${dayToken}`
  }
  /** @see ../docs/product/dashboard.md#homework-progress */
  function homeworkRow(row: typeof homeworkRows[number]) {
    const { subject, items, done, next, group } = row
    const qualityOpen = items.find((item) => item.qualityOpen)
    const status = group === 'complete' ? qualityOpen ? 'Работа сдана' : 'Всё завершено' : next?.state === 'unclear' ? 'Критерий неясен' : next?.state === 'checking' ? 'Ждём проверки' : done ? `${done} из ${items.length} завершено` : 'Нужно сделать'
    return <button className={`day-dashboard-homework-row ${group}`} key={subject.id} type="button" onClick={() => homeworkToken && openDay(homeworkToken, 'homework', next?.id)}>
      <span className="day-dashboard-icon" aria-hidden="true">{subject.icon}</span>
      <span className="day-dashboard-homework-row-body"><strong>{subject.name}</strong><span className="day-dashboard-homework-status">{status}</span>{next && <span className="day-dashboard-homework-next">{next.title} · {next.detail}</span>}{group === 'complete' && <span className="day-dashboard-homework-next">{qualityOpen ? qualityOpen.detail : subject.tasks.map((task) => task.title).join(' · ')}</span>}</span>
      <ArrowRight size={18} aria-hidden="true" />
    </button>
  }

  if (error && !index) return <div className="day-dashboard-error"><h1>Не получилось открыть dashboard</h1><p>{error}</p></div>
  if (!index) return <p className="day-dashboard-loading">Загружаем dashboard…</p>
  return <div className="day-dashboard">
    {error && <p className="day-dashboard-error" role="alert">{error}</p>}
    <section className="day-dashboard-calendar" aria-label="Выбор дня">
      <div className="day-dashboard-heading"><div><CalendarDays size={20} /><h2>Выберите день</h2></div></div>
      <div className="day-dashboard-dates" ref={datesRef}>{index.days.map((day) => <button key={day.date} type="button" className={`day-dashboard-date ${day.date === today ? 'today' : ''} ${day.date === selectedDate ? 'selected' : ''} ${isWeekend(day.date) ? 'weekend' : ''}`} aria-current={day.date === today ? 'date' : undefined} aria-pressed={day.date === selectedDate} onClick={() => chooseDay(day.date)}>
        <span>{dateLabel(day.date, { weekday: 'short' })}</span><strong>{dateLabel(day.date, { day: 'numeric' })}</strong><small>{day.homework.length ? `${day.homework.length} ДЗ` : day.schedule.length ? 'уроки' : '—'}</small>
      </button>)}</div>
    </section>

    <div className="day-dashboard-selected-heading">{personalParent && <a className="day-dashboard-parent-home" href="#/">← Все дети</a>}<div className="day-dashboard-kicker">{parent ? 'Панель родителя' : 'Мой план'} · выбранный день</div><h1>{dateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</h1></div>

    {weekendWorks.map((slot) => <WeekendMathSlot key={`${slot.dayToken}:${slot.taskIds.join(',')}`} token={slot.dayToken} taskIds={slot.taskIds} parent={parent} lessonDate={slot.lessonDate} dueDate={slot.dueDate} title={slot.title} />)}

    <div className="day-dashboard-grid">
      <div className="day-dashboard-main">
      <section className="day-dashboard-card" aria-label="Расписание выбранного дня">
        <div className="day-dashboard-heading"><div><CalendarDays size={20} /><h2>Расписание</h2></div><small>{dateLabel(selectedDate)}<br />МЭШ проверен: {checkedLabel(selectedEntry?.checkedAt ?? null)}</small></div>
        {selectedEntry?.schedule.length ? <ul className="day-dashboard-lessons">{selectedEntry.schedule.map((lesson, index) => {
          const subjectId = lessonSubjectId(lesson.subject)
          const subject = currentSubjects.find((item) => item.id === subjectId || item.name.toLocaleLowerCase('ru-RU') === lesson.subject.toLocaleLowerCase('ru-RU'))
          const rawHomework = selectedEntry.homework.filter((item) => item.subject.toLocaleLowerCase('ru-RU') === lesson.subject.toLocaleLowerCase('ru-RU') || subjectId != null && lessonSubjectId(item.subject) === subjectId)
          const updatedSubjects = selectedEntry.homeworkUpdate?.subjects ?? []
          const updatedAt = selectedEntry.homeworkUpdate?.at
          const recentUpdate = updatedAt ? Date.parse(updatedAt) : NaN
          const newlyAssigned = Number.isFinite(recentUpdate) && now >= recentUpdate && now - recentUpdate < 3 * 24 * 60 * 60 * 1000 && updatedSubjects.some((name) => name.toLocaleLowerCase('ru-RU') === lesson.subject.toLocaleLowerCase('ru-RU') || subjectId != null && lessonSubjectId(name) === subjectId)
          const taskItems = subject ? lessonWorkItems(subject.tasks, uploads, reviews, parentDecisions.events, tests, scores) : []
          const placementItems: LessonWorkItem[] = (selectedPage?.testPlacements ?? []).filter((placement) => !placement.taskId && (placement.originDate ?? selectedDate) === selectedDate && placement.subjectId === subjectId).map((placement) => {
            const test = tests[placement.token]
            const score = scores[placement.token]
            const state: LessonWorkItem['state'] = test?.status === 'submitted' ? !score ? 'checking' : score.points === score.maxPoints ? 'done' : 'todo' : 'todo'
            return { id: `quiz:${placement.token}`, title: test?.title ?? 'Самопроверка', state, detail: state === 'done' ? `Тест: ${score?.points} из ${score?.maxPoints} верно` : state === 'checking' ? 'Ответы отправлены, результат уточняется' : test?.status === 'submitted' ? `Есть ошибки: ${score?.points} из ${score?.maxPoints} верно` : 'Нужно пройти тест' }
          })
          const items = [...taskItems, ...placementItems]
          const done = items.filter((item) => item.state === 'done').length
          const checking = items.filter((item) => item.state === 'checking').length
          const unclear = items.filter((item) => item.state === 'unclear').length
          const qualityOpen = items.some((item) => item.qualityOpen)
          const tone = items.length ? checking ? 'checking' : unclear ? 'unclear' : done === items.length ? 'complete' : done ? 'partial' : 'empty' : rawHomework.length ? 'assigned' : selectedEntry.complete && (selectedPage || selectedDate <= today) ? 'none' : 'unknown'
          const badge = items.length ? checking ? 'Проверяем' : unclear ? 'Критерий неясен' : qualityOpen && done === items.length ? 'Сдано' : `${done} из ${items.length}` : tone === 'none' ? 'Пока нет ДЗ' : tone === 'assigned' ? 'Задано' : 'Уточняем'
          return <li key={`${index}-${lesson.subject}`}><details data-subject={lesson.subject} className={`day-dashboard-lesson day-dashboard-lesson-${tone}${newlyAssigned ? ' has-new-homework' : ''}`}>
            <summary><time>{lessonTime(lesson.start)}</time><span className="day-dashboard-lesson-name">{lesson.subject}{newlyAssigned && <span className="day-dashboard-lesson-new">Новое ДЗ</span>}</span><span className="day-dashboard-lesson-badge">{tone === 'complete' && <CheckCircle2 size={13} aria-hidden="true" />}{badge}<ChevronDown size={15} aria-hidden="true" /></span></summary>
            <div className="day-dashboard-lesson-body">{subject?.tasks.some((task) => task.dueDate && task.dueDate !== (task.lessonDate ?? selectedDate)) && <p className="day-dashboard-lesson-update">Срок сдачи: {dateLabel(subject.tasks.find((task) => task.dueDate && task.dueDate !== (task.lessonDate ?? selectedDate))!.dueDate!)} · по записи МЭШ. Задание относится к этому уроку.</p>}{items.length ? <div className="day-dashboard-lesson-items">{items.map((item) => <div className={`day-dashboard-lesson-item ${item.state}`} key={item.id}><span className="day-dashboard-lesson-item-symbol" aria-hidden="true">{item.state === 'done' ? '✓' : item.state === 'checking' ? '◷' : item.state === 'unclear' ? '?' : '→'}</span><div><strong>{item.state === 'done' ? 'Сделано' : item.state === 'checking' ? 'Проверяем' : item.state === 'unclear' ? 'Разобрано' : 'Осталось'}: {item.title}</strong><span>{item.detail}</span>{homeworkToken && <button type="button" onClick={() => openDay(homeworkToken, 'homework', item.id)}>{item.state === 'todo' ? 'Перейти к заданию' : item.state === 'checking' ? 'Открыть работу' : 'Посмотреть результат'} <ArrowRight size={14} aria-hidden="true" /></button>}</div></div>)}</div>
              : rawHomework.length ? <div className="day-dashboard-lesson-raw">{rawHomework.map((item, rawIndex) => <p key={rawIndex}>{item.text}</p>)}<small>Точный разбор задания ещё готовится.</small>{homeworkToken && <button type="button" onClick={() => openDay(homeworkToken, 'homework')}>Открыть ДЗ <ArrowRight size={14} aria-hidden="true" /></button>}</div>
                : <p>{tone === 'none' ? 'На последней сверке задания к этому уроку не было. Оно может появиться позже.' : 'Сведения о домашнем задании ещё уточняются.'}</p>}{newlyAssigned && <p className="day-dashboard-lesson-update">ДЗ обновлено: {checkedLabel(updatedAt ?? null)}.</p>}<small>Последняя сверка МЭШ: {checkedLabel(selectedEntry.checkedAt)}.</small></div>
          </details></li>
        })}</ul> : <p className="day-dashboard-empty">{selectedEntry?.complete ? 'Уроков на эту дату нет.' : `Расписание ещё не подтверждено. Последняя проверка: ${checkedLabel(selectedEntry?.checkedAt ?? null)}.`}</p>}
        {selectedEntry?.dayToken && <button className="day-dashboard-detail-link" type="button" onClick={() => openDay(selectedEntry.dayToken!)}>Открыть подробное расписание <ArrowRight size={17} /></button>}
      </section>
      <section className="day-dashboard-card" aria-label="Домашнее задание выбранного дня">
        <div className="day-dashboard-heading"><div><BookOpen size={20} /><h2>Домашнее задание</h2></div><small>Уроки {dateLabel(selectedDate)}</small></div>
        {selectedPage && currentSubjects.length ? <div className="day-dashboard-homework-overview">
          <p className={`day-dashboard-homework-summary ${actionRows.length ? 'action' : waitingRows.length ? 'waiting' : 'complete'}`}>{actionRows.length ? `Требуют внимания: ${actionRows.length} ${word(actionRows.length, 'предмет', 'предмета', 'предметов')}` : waitingRows.length ? 'От ученика пока не требуется действий' : 'Всё заданное сделано'}</p>
          {actionRows.length > 0 && <div className="day-dashboard-homework-group"><h3>Что сделать</h3>{actionRows.map(homeworkRow)}</div>}
          {waitingRows.length > 0 && <div className="day-dashboard-homework-group"><h3>Ждём проверку или уточнение</h3>{waitingRows.map(homeworkRow)}</div>}
          {completeRows.length > 0 && <details className="day-dashboard-homework-complete"><summary><CheckCircle2 size={18} aria-hidden="true" /><span>Сделано · {completeRows.length} {word(completeRows.length, 'предмет', 'предмета', 'предметов')}</span><ChevronDown size={17} aria-hidden="true" /></summary><div>{completeRows.map(homeworkRow)}</div></details>}
        </div> : selectedEntry?.homework.length ? <div className="day-dashboard-mesh">{selectedEntry.homework.map((item, index) => <p key={index}><strong>{item.subject}</strong><span>{item.text}</span></p>)}<small>Точный текст МЭШ · разбор страницы готовится</small></div> : <p className="day-dashboard-empty">{selectedEntry?.complete ? 'По сохранённым данным МЭШ ДЗ на эту дату не опубликовано.' : 'ДЗ пока не опубликовано.'} Последняя проверка: {checkedLabel(selectedEntry?.checkedAt ?? null)}.</p>}
        {homeworkToken && <button className="day-dashboard-detail-link" type="button" onClick={() => openDay(homeworkToken, 'homework')}>Открыть подробное ДЗ <ArrowRight size={17} /></button>}
      </section>
      </div>
      <aside className="day-dashboard-side">
        <section className="day-dashboard-card" aria-label="Оценки по предметам"><div className="day-dashboard-heading"><div><Sparkles size={20} /><h2>Оценки</h2></div>{gradeRows.length > 0 && <small>{gradeRows.length} {word(gradeRows.length, 'предмет', 'предмета', 'предметов')}</small>}</div>
          {gradeRows.length ? <div className="day-dashboard-grades">{gradeRows.map((grade) => {
            const marks = gradeDetails.get(grade.id)?.grades ?? []
            return <details key={grade.id} className="day-dashboard-grade"><summary><span>{grade.name}</span><strong className={grade.allFives ? 'excellent' : grade.watch ? 'watch' : ''}>{grade.allFives && '✨ '}{grade.average.toFixed(2).replace('.', ',')}</strong><ChevronDown size={16} aria-hidden="true" /></summary>
              <div className="day-dashboard-grade-detail">{marks.length ? <><p>{marks.length} {word(marks.length, 'оценка', 'оценки', 'оценок')} в сохранённом срезе:</p><ul>{marks.map(({ mark, weight }, index) => <li key={`${index}-${mark}-${weight}`} className={`mark-${mark}`} aria-label={`Оценка ${mark}, вес ${weight}`}>{mark}{weight !== 1 && <small>вес {weight}</small>}</li>)}</ul><small>Даты и типы отдельных работ в этом срезе не сохранены.</small></> : <p>Список оценок для этого предмета пока не сохранён.</p>}</div>
            </details>
          })}</div> : <p>Срез оценок ещё не опубликован.</p>}
          {gradeSource?.gradeAsOf && <p className="day-dashboard-grade-asof">Сохранённый срез МЭШ на {dateLabel(gradeSource.gradeAsOf.slice(0, 10))}. Новые оценки появятся после синхронизации, не при открытии страницы.</p>}
        </section>
        <section className="day-dashboard-card"><div className="day-dashboard-heading"><div><Clock3 size={20} /><h2>Синхронизация</h2></div></div>
          <p>МЭШ за {dateLabel(selectedDate)}: {checkedLabel(selectedEntry?.checkedAt ?? null)}.</p>
          {parent && selectedPage?.changes?.[0] && <p>В последнем обновлении: добавлено {selectedPage.changes[0].added.length}, уточнено {selectedPage.changes[0].changed.length}.</p>}
          {uploads.some((upload) => upload.status === 'pending') && <p><CheckCircle2 size={15} /> Фото ожидают разбора: {uploads.filter((upload) => upload.status === 'pending').length}.</p>}
          <small>Данные обновляются из Firestore при открытой странице.</small>
        </section>
      </aside>
    </div>
    <p className="day-dashboard-source">Расписание и ДЗ показаны для выбранной даты. Работы и тесты обновляются из Firestore.</p>
  </div>
}
