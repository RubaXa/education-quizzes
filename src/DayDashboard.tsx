import { useEffect, useRef, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronDown, Clock3, Sparkles } from 'lucide-react'
import { watchDayPage } from '@/lib/dayStore'
import type { DayPageData } from '@/lib/dayStore'
import { clearCachedDayDashboard, readCachedDayDashboard, watchDayDashboard } from '@/lib/dayDashboardStore'
import type { DayDashboardData } from '@/lib/dayDashboardStore'
import { lessonSubjectId, lessonWorkItems, linkedQuizWorkItems } from '@/lib/homeworkStatus'
import type { LessonWorkItem } from '@/lib/homeworkStatus'
import { clearCachedLessonStatuses, lessonCacheKey, readCachedLessonStatuses, writeCachedLessonStatuses } from '@/lib/dayDashboardLessonCache'
import { clearCachedDashboardView, readCachedGrades, readCachedHomeworkRows, writeCachedGrades, writeCachedHomeworkRows } from '@/lib/dayDashboardViewCache'
import type { CachedHomeworkRow } from '@/lib/dayDashboardViewCache'
import { currentEducationPersonId, readCachedPersonalContext } from '@/lib/personalAccess'
import { useDashboardDayWork } from '@/lib/useDashboardDayWork'
import WeekendMathSlot from './WeekendMathSlot'
import './DayDashboard.css'
import { reportUiError } from '@/lib/uiErrors'
import { DATA_UPDATE_MESSAGE } from '@/lib/dayCompatibility'
import { homeworkUpdateKey, markHomeworkUpdateSeen, wasHomeworkUpdateSeen } from '@/lib/homeworkUpdateReceipt'
import DataCompatibilityNotice from './components/DataCompatibilityNotice'

function moscowToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`))
}
function checkedLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(value)) : 'ещё не проверяли'
}
/** @see ../docs/product/dashboard.md#sync-freshness */
function checkedAge(value: string | null, now: number) {
  if (!value) return ''
  const checked = Date.parse(value)
  if (!Number.isFinite(checked)) return ''
  const minutes = Math.max(0, Math.floor((now - checked) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} ${word(minutes, 'минуту', 'минуты', 'минут')} назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${word(hours, 'час', 'часа', 'часов')} назад`
  const days = Math.floor(hours / 24)
  return `${days} ${word(days, 'день', 'дня', 'дней')} назад`
}
function word(count: number, one: string, few: string, many: string) {
  const n = count % 100
  if (n >= 11 && n <= 14) return many
  return count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many
}
function isWeekend(date: string) { return [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) }
function nextCalendarDate(date: string) { const day = new Date(`${date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + 1); return day.toISOString().slice(0, 10) }
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
    try { personalParent = Boolean(currentEducationPersonId()) }
    catch {
      const cached = readCachedPersonalContext()
      const uid = getAuth().currentUser?.uid
      personalParent = Boolean(cached && (!uid || uid === cached.session.deviceUid) &&
        cached.profile.children.some((child) => child.role === 'parent' && child.dashboardToken === token))
    }
  }
  const [index, setIndex] = useState<DayDashboardData | undefined>(() => readCachedDayDashboard(token, parent ? 'parent' : 'student') ?? undefined)
  const [gradeState, setGradeState] = useState<{ token: string; page: DayPageData }>()
  const [selected, setSelected] = useState(() => {
    if (sessionStorage.getItem('education-dashboard-selection-day') === moscowToday()) return sessionStorage.getItem('education-dashboard-selected-date') ?? moscowToday()
    if (localStorage.getItem('education-dashboard-selection-day') === moscowToday()) return localStorage.getItem('education-dashboard-selected-date') ?? moscowToday()
    return moscowToday()
  })
  const [focusSubject, setFocusSubject] = useState(() => sessionStorage.getItem('education-dashboard-focus-subject') ?? '')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [scheduleOverride, setScheduleOverride] = useState<{ date: string; open: boolean } | null>(null)
  const [seenUpdates, setSeenUpdates] = useState<Set<string>>(() => new Set())
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
      }, (cause) => {
        if ((cause as { code?: string }).code === 'permission-denied') {
          clearCachedDayDashboard(token)
          clearCachedLessonStatuses(token, parent ? 'parent' : 'student')
          clearCachedDashboardView(parent ? 'parent' : 'student', token)
          setIndex(undefined)
        }
        setError(reportUiError(cause, 'Учебный день'))
      })
    }).catch((cause) => { if (active) setError(reportUiError(cause, 'Учебный день')) })
    return () => { active = false; stop?.() }
  }, [token, parent])

  const selectedDate = index?.days.some((day) => day.date === selected) ? selected : today
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
  // The timetable belongs to the selected day; the card below prepares the
  // nearest following school day. Weekend dates without lessons are skipped.
  const nextEntry = index?.days.find((day) => day.date > selectedDate && (day.schedule.length > 0 || day.homework.length > 0))
  const nextDate = nextEntry?.date ?? ''
  const nextHomeworkToken = nextEntry?.homeworkDayToken
  const selectedWork = useDashboardDayWork(homeworkToken, selectedDate, parent, setError)
  const nextWork = useDashboardDayWork(nextHomeworkToken, nextDate, parent, setError)
  const selectedPage = selectedWork.page
  const currentSubjects = selectedWork.subjects
  const { uploads, reviews, tests, scores, parentDecisions } = selectedWork
  const gradeToken = index?.days.filter((day) => day.date <= today && day.dayToken).sort((a, b) => b.date.localeCompare(a.date))[0]?.dayToken
  useEffect(() => {
    if (!gradeToken) return
    return watchDayPage(gradeToken, (page) => setGradeState({ token: gradeToken, page }),
      (cause) => setError(reportUiError(cause, 'Учебный день')),
      { serverConfirmedOnly: Boolean(readCachedGrades(parent ? 'parent' : 'student', token, gradeToken)) })
  }, [gradeToken, parent, token])
  useEffect(() => {
    const taskId = sessionStorage.getItem('education-dashboard-focus-task')
    if (!taskId || !selectedPage || !homeworkToken) return
    sessionStorage.removeItem('education-dashboard-focus-task')
    sessionStorage.setItem('education-day-dashboard-return', `#/${parent ? 'days-parent' : 'days'}/${token}`)
    sessionStorage.setItem('education-day-initial-tab', 'homework')
    sessionStorage.setItem('education-day-focus-task', JSON.stringify({ dayToken: homeworkToken, taskId }))
    window.location.hash = `#/${parent ? 'day-parent' : 'day'}/${homeworkToken}`
  }, [selectedPage, homeworkToken, parent, token])
  useEffect(() => {
    if (![...reviews, ...nextWork.reviews].some((review) => review.processing)) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [reviews, nextWork.reviews])
  useEffect(() => {
    const refreshTime = () => setNow(Date.now())
    const timer = window.setInterval(refreshTime, 60_000)
    document.addEventListener('visibilitychange', refreshTime)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshTime) }
  }, [])

  const weekendWorks = index?.weekendWork?.filter((slot) => slot.dates.includes(selectedDate)) ?? []
  const liveHomeworkRows: CachedHomeworkRow[] = nextWork.subjects.map((subject) => {
    const items = lessonWorkItems(subject.tasks, nextWork.uploads, nextWork.reviews, nextWork.parentDecisions.events, nextWork.tests, nextWork.scores)
    const done = items.filter((item) => item.state === 'done').length
    const group: CachedHomeworkRow['group'] = items.some((item) => item.state === 'todo') ? 'action' : items.some((item) => item.state === 'checking' || item.state === 'unclear') ? 'waiting' : 'complete'
    return { subject: { id: subject.id, name: subject.name, icon: subject.icon,
      tasks: subject.tasks.map((task) => ({ title: task.title })) }, items, done, group }
  }).filter((row) => row.items.length > 0)
  const role = parent ? 'parent' : 'student'
  const homeworkRows = nextWork.ready ? liveHomeworkRows : nextHomeworkToken ? readCachedHomeworkRows(role, token, nextHomeworkToken) : []
  // A saved status projection can be older than the freshly published MESH
  // calendar. Keep its known statuses, but never let it hide a new assignment.
  const unprojectedHomework = (nextEntry?.homework ?? []).filter((item) =>
    !homeworkRows.some((row) => row.subject.name.toLocaleLowerCase('ru-RU') === item.subject.toLocaleLowerCase('ru-RU')
      || lessonSubjectId(row.subject.name) != null && lessonSubjectId(row.subject.name) === lessonSubjectId(item.subject)))
  const completeHomeworkSnapshot = nextWork.ready && nextHomeworkToken ? JSON.stringify(liveHomeworkRows) : ''
  useEffect(() => {
    if (completeHomeworkSnapshot && nextHomeworkToken) writeCachedHomeworkRows(role, token, nextHomeworkToken, JSON.parse(completeHomeworkSnapshot))
  }, [completeHomeworkSnapshot, nextHomeworkToken, role, token])
  const actionRows = homeworkRows.filter((row) => row.group === 'action')
  const waitingRows = homeworkRows.filter((row) => row.group === 'waiting')
  const completeRows = homeworkRows.filter((row) => row.group === 'complete')
  const gradeSource = gradeToken && gradeState && gradeState.token === gradeToken ? gradeState.page
    : gradeToken ? readCachedGrades(role, token, gradeToken) : null
  useEffect(() => {
    if (gradeState && gradeState.token === gradeToken && gradeToken) writeCachedGrades(role, token, gradeToken, gradeState.page)
  }, [gradeState, gradeToken, role, token])
  const gradeRows = gradeSource?.gradeSummary ?? []
  const gradeDetails = new Map((gradeSource?.grades ?? []).map((item) => [item.id, item]))

  /** @see ../docs/product/dashboard.md#dashboard-warm-start */
  const savedLessons = new Map(readCachedLessonStatuses(token, role, selectedDate).map((row) => [row.key, row]))
  const lessonRows = selectedEntry?.schedule.map((lesson) => {
    const subjectId = lessonSubjectId(lesson.subject)
    const subject = currentSubjects.find((item) => item.id === subjectId || subjectId != null && lessonSubjectId(item.name) === subjectId || item.name.toLocaleLowerCase('ru-RU') === lesson.subject.toLocaleLowerCase('ru-RU'))
    const rawHomework = selectedEntry.homework.filter((item) => item.subject.toLocaleLowerCase('ru-RU') === lesson.subject.toLocaleLowerCase('ru-RU') || subjectId != null && lessonSubjectId(item.subject) === subjectId)
    const updatedSubjects = selectedEntry.homeworkUpdate?.subjects ?? []
    const updatedAt = selectedEntry.homeworkUpdate?.at
    const recentUpdate = updatedAt ? Date.parse(updatedAt) : NaN
    const updateKey = updatedAt ? homeworkUpdateKey(token, selectedDate, lesson.subject, updatedAt) : ''
    const newlyAssigned = Number.isFinite(recentUpdate) && now >= recentUpdate && now - recentUpdate < 3 * 24 * 60 * 60 * 1000 && updatedSubjects.some((name) => name.toLocaleLowerCase('ru-RU') === lesson.subject.toLocaleLowerCase('ru-RU') || subjectId != null && lessonSubjectId(name) === subjectId)
      && !seenUpdates.has(updateKey) && !wasHomeworkUpdateSeen(updateKey)
    const taskItems = subject ? lessonWorkItems(subject.tasks, uploads, reviews, parentDecisions.events, tests, scores) : []
    const placementItems: LessonWorkItem[] = (selectedPage?.testPlacements ?? []).filter((placement) => !placement.taskId && (placement.originDate ?? selectedDate) === selectedDate && placement.subjectId === subjectId && !tests[placement.token]?.linkedToTestId).flatMap((placement) => {
      const test = tests[placement.token]
      const score = scores[placement.token]
      const state: LessonWorkItem['state'] = test?.status === 'submitted' ? !score ? 'checking' : score.points === score.maxPoints ? 'done' : 'todo' : 'todo'
      return [{ id: `quiz:${placement.token}`, title: test?.title ?? 'Самопроверка', state, detail: state === 'done' ? `Тест: ${score?.points} из ${score?.maxPoints} верно` : state === 'checking' ? 'Ответы отправлены, результат уточняется' : test?.status === 'submitted' ? `Есть ошибки: ${score?.points} из ${score?.maxPoints} верно` : 'Нужно пройти тест' }, ...linkedQuizWorkItems(placement.token, tests, scores)]
    })
    const liveItems = [...taskItems, ...placementItems]
    const liveReferenceTask = subject?.tasks.find((task) => task.referenceDate)
    const done = liveItems.filter((item) => item.state === 'done').length
    const checking = liveItems.filter((item) => item.state === 'checking').length
    const unclear = liveItems.filter((item) => item.state === 'unclear').length
    const qualityOpen = liveItems.some((item) => item.qualityOpen)
    const liveTone = liveItems.length ? checking ? 'checking' : unclear ? 'unclear' : done === liveItems.length ? 'complete' : done ? 'partial' : 'empty' : liveReferenceTask ? 'reference' : rawHomework.length ? 'assigned' : selectedEntry.complete && (selectedPage || selectedDate <= today) ? 'none' : 'unknown'
    const liveBadge = liveItems.length ? checking ? 'Проверяем' : unclear ? 'Критерий неясен' : qualityOpen && done === liveItems.length ? 'Сдано' : `${done} из ${liveItems.length}` : liveReferenceTask?.referenceDate ? `См. ${dateLabel(liveReferenceTask.referenceDate)}` : liveTone === 'none' ? 'Пока нет ДЗ' : liveTone === 'assigned' ? 'Задано' : 'Уточняем'
    const key = lessonCacheKey(lesson.start, lesson.subject)
    const cached = savedLessons.get(key)
    const shown = selectedWork.ready ? { key, tone: liveTone, badge: liveBadge, items: liveItems,
      referenceDate: liveReferenceTask?.referenceDate, referenceText: liveReferenceTask?.meshText } : cached
    const referenceDate = shown?.referenceDate
    const referenceToken = referenceDate ? index?.days.find((day) => day.date === referenceDate)?.homeworkDayToken : null
    return { lesson, subject, rawHomework, updatedAt, updateKey, newlyAssigned,
      items: shown?.items ?? [], tone: shown?.tone ?? 'unknown', badge: shown?.badge ?? 'Уточняем',
      referenceDate, referenceText: shown?.referenceText, referenceToken, key }
  }) ?? []
  /** @see ../docs/product/dashboard.md#progressive-schedule */
  const scheduleFinished = lessonRows.length > 0 && lessonRows.every(({ lesson }) => {
    const end = Date.parse(lesson.end)
    return Number.isFinite(end) && now >= end
  })
  const scheduleCollapsed = scheduleOverride?.date === selectedDate ? !scheduleOverride.open : scheduleFinished
  const completeLessonSnapshot = selectedWork.ready ? JSON.stringify(lessonRows.map(({ key, tone, badge, items, referenceDate, referenceText }) =>
    ({ key, tone, badge, items, referenceDate, referenceText }))) : ''
  useEffect(() => {
    if (!completeLessonSnapshot) return
    writeCachedLessonStatuses(token, role, selectedDate, JSON.parse(completeLessonSnapshot))
  }, [completeLessonSnapshot, role, selectedDate, token])

  function chooseDay(date: string) {
    setSelected(date)
    setFocusSubject('')
    sessionStorage.removeItem('education-dashboard-focus-subject')
    sessionStorage.setItem('education-dashboard-selected-date', date)
    sessionStorage.setItem('education-dashboard-selection-day', today)
    try {
      localStorage.setItem('education-dashboard-selected-date', date)
      localStorage.setItem('education-dashboard-selection-day', today)
    } catch { /* The open calendar still remembers this date. */ }
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
    const { subject, items, done, group } = row
    const next = items.find((item) => item.state === 'todo') ?? items.find((item) => item.state === 'checking') ?? items.find((item) => item.state === 'unclear')
    const qualityOpen = items.find((item) => item.qualityOpen)
    const status = group === 'complete' ? qualityOpen ? 'Работа сдана' : 'Всё завершено' : next?.state === 'unclear' ? 'Критерий неясен' : next?.state === 'checking' ? 'Ждём проверки' : done ? `${done} из ${items.length} завершено` : 'Нужно сделать'
    return <button className={`day-dashboard-homework-row ${group}`} key={subject.id} type="button" onClick={() => nextHomeworkToken && openDay(nextHomeworkToken, 'homework', next?.id)}>
      <span className="day-dashboard-icon" aria-hidden="true">{subject.icon}</span>
      <span className="day-dashboard-homework-row-body"><strong>{subject.name}</strong><span className="day-dashboard-homework-status">{status}</span>{next && <span className="day-dashboard-homework-next">{next.title} · {next.detail}</span>}{group === 'complete' && <span className="day-dashboard-homework-next">{qualityOpen ? qualityOpen.detail : subject.tasks.map((task) => task.title).join(' · ')}</span>}</span>
      <ArrowRight size={18} aria-hidden="true" />
    </button>
  }

  if (error === DATA_UPDATE_MESSAGE) return <DataCompatibilityNotice />
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

    <div className={`day-dashboard-selected-heading${parent ? ' parent' : ''}`}>{personalParent && <a className="day-dashboard-parent-home" href="#/">← Все дети</a>}<div className="day-dashboard-kicker">{parent ? 'Панель родителя' : 'Мой план'} · выбранный день</div><h1>{dateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</h1></div>

    {weekendWorks.map((slot) => <WeekendMathSlot key={`${slot.dayToken}:${slot.taskIds.join(',')}`} token={slot.dayToken} taskIds={slot.taskIds} parent={parent} lessonDate={slot.lessonDate} dueDate={slot.dueDate} title={slot.title} />)}

    <div className="day-dashboard-grid">
      <div className="day-dashboard-main">
      <section className="day-dashboard-card" aria-label="Расписание выбранного дня" data-collapsed={scheduleCollapsed}>
        <div className="day-dashboard-heading"><div><CalendarDays size={20} /><h2>Расписание</h2></div><small>{dateLabel(selectedDate)}<br />МЭШ проверен: {checkedLabel(selectedEntry?.checkedAt ?? null)}</small></div>
        {Boolean(selectedEntry?.schedule.length) && <button className="day-dashboard-schedule-toggle" type="button" aria-expanded={!scheduleCollapsed} onClick={() => setScheduleOverride({ date: selectedDate, open: scheduleCollapsed })}>{scheduleCollapsed ? `Показать уроки · ${lessonRows.length}` : 'Свернуть расписание'} <ChevronDown size={16} aria-hidden="true" /></button>}
        {!scheduleCollapsed && (selectedEntry?.schedule.length ? <ul className="day-dashboard-lessons">{lessonRows.map(({ lesson, subject, rawHomework, updatedAt, updateKey, newlyAssigned, items, tone, badge, referenceDate, referenceText, referenceToken }, lessonIndex) => {
          const end = Date.parse(lesson.end)
          const ended = Number.isFinite(end) && now >= end
          return <li key={`${selectedDate}-${lessonIndex}-${lesson.subject}-${ended}`}><details open={!ended} data-subject={lesson.subject} className={`day-dashboard-lesson day-dashboard-lesson-${tone}${newlyAssigned ? ' has-new-homework' : ''}`}>
            <summary onClick={() => {
              if (!newlyAssigned || !updateKey) return
              markHomeworkUpdateSeen(updateKey)
              setSeenUpdates((current) => new Set(current).add(updateKey))
              window.dispatchEvent(new CustomEvent('education-homework-update-seen', {
                detail: { dashboardToken: token, date: selectedDate, subject: lesson.subject },
              }))
            }}><time>{lessonTime(lesson.start)}</time><span className="day-dashboard-lesson-name">{lesson.subject}{newlyAssigned && <span className="day-dashboard-lesson-new">Новое ДЗ</span>}</span><span className="day-dashboard-lesson-badge">{tone === 'complete' && <CheckCircle2 size={13} aria-hidden="true" />}{badge}<ChevronDown size={15} aria-hidden="true" /></span></summary>
            <div className="day-dashboard-lesson-body">{subject?.tasks.some((task) => task.dueDate && task.dueDate !== (task.lessonDate ?? selectedDate)) && <p className="day-dashboard-lesson-update">Срок сдачи: {dateLabel(subject.tasks.find((task) => task.dueDate && task.dueDate !== (task.lessonDate ?? selectedDate))!.dueDate!)} · по записи МЭШ. Задание относится к этому уроку.</p>}{items.length ? <div className="day-dashboard-lesson-items">{items.map((item) => <div className={`day-dashboard-lesson-item ${item.state}`} key={item.id}><span className="day-dashboard-lesson-item-symbol" aria-hidden="true">{item.state === 'done' ? '✓' : item.state === 'checking' ? '◷' : item.state === 'unclear' ? '?' : '→'}</span><div><strong>{item.state === 'done' ? 'Сделано' : item.state === 'checking' ? 'Проверяем' : item.state === 'unclear' ? 'Разобрано' : 'Осталось'}: {item.title}</strong><span>{item.detail}</span>{homeworkToken && <button type="button" onClick={() => openDay(homeworkToken, 'homework', item.id)}>{item.state === 'todo' ? 'Перейти к заданию' : item.state === 'checking' ? 'Открыть работу' : 'Посмотреть результат'} <ArrowRight size={14} aria-hidden="true" /></button>}</div></div>)}</div>
              : referenceDate ? <div className="day-dashboard-lesson-raw"><p>{referenceText}</p><small>Это ссылка на уже назначенное ДЗ. Второй раз выполнять его не нужно.</small>{referenceToken && <button type="button" onClick={() => openDay(referenceToken, 'homework')}>Открыть ДЗ за {dateLabel(referenceDate)} <ArrowRight size={14} aria-hidden="true" /></button>}</div>
              : rawHomework.length ? <div className="day-dashboard-lesson-raw">{rawHomework.map((item, rawIndex) => <p key={rawIndex}>{item.text}</p>)}<small>Точный разбор задания ещё готовится.</small>{homeworkToken && <button type="button" onClick={() => openDay(homeworkToken, 'homework')}>Открыть ДЗ <ArrowRight size={14} aria-hidden="true" /></button>}</div>
                : <p>{tone === 'none' ? 'На последней сверке задания к этому уроку не было. Оно может появиться позже.' : 'Сведения о домашнем задании ещё уточняются.'}</p>}{newlyAssigned && <p className="day-dashboard-lesson-update">ДЗ обновлено: {checkedLabel(updatedAt ?? null)}.</p>}<small>Последняя сверка МЭШ: {checkedLabel(selectedEntry.checkedAt)}.</small></div>
          </details></li>
        })}</ul> : <p className="day-dashboard-empty">{selectedEntry?.complete ? 'Уроков на эту дату нет.' : `Расписание ещё не подтверждено. Последняя проверка: ${checkedLabel(selectedEntry?.checkedAt ?? null)}.`}</p>)}
        {!scheduleCollapsed && selectedEntry?.dayToken && <button className="day-dashboard-detail-link" type="button" onClick={() => openDay(selectedEntry.dayToken!)}>Открыть подробное расписание <ArrowRight size={17} /></button>}
      </section>
      <section className="day-dashboard-card" aria-label="Домашнее задание следующего учебного дня">
        <div className="day-dashboard-heading"><div><BookOpen size={20} /><h2>{nextDate === nextCalendarDate(selectedDate) ? 'Домашнее задание на завтра' : 'Домашнее задание к следующему учебному дню'}</h2></div>{nextEntry && <small>Уроки {dateLabel(nextDate, { weekday: 'long', day: 'numeric', month: 'long' })}</small>}</div>
        {!nextEntry ? <p className="day-dashboard-empty">Следующий учебный день пока не найден в проверенном расписании МЭШ.</p>
          : homeworkRows.length > 0 ? <div className="day-dashboard-homework-overview">
          <p className={`day-dashboard-homework-summary ${actionRows.length ? 'action' : waitingRows.length || unprojectedHomework.length ? 'waiting' : 'complete'}`}>{actionRows.length ? `Требуют внимания: ${actionRows.length} ${word(actionRows.length, 'предмет', 'предмета', 'предметов')}${unprojectedHomework.length ? ` · ещё ${unprojectedHomework.length} ${word(unprojectedHomework.length, 'задание сверяется', 'задания сверяются', 'заданий сверяются')}` : ''}` : unprojectedHomework.length ? `${unprojectedHomework.length} ${word(unprojectedHomework.length, 'задание сверяется', 'задания сверяются', 'заданий сверяются')}` : waitingRows.length ? 'От ученика пока не требуется действий' : 'Всё заданное сделано'}</p>
          {actionRows.length > 0 && <div className="day-dashboard-homework-group"><h3>Что сделать</h3>{actionRows.map(homeworkRow)}</div>}
          {waitingRows.length > 0 && <div className="day-dashboard-homework-group"><h3>Ждём проверку или уточнение</h3>{waitingRows.map(homeworkRow)}</div>}
          {unprojectedHomework.length > 0 && <div className="day-dashboard-mesh" aria-label="Новые задания МЭШ без сверенного статуса">{unprojectedHomework.map((item) => <p key={item.subject}><strong>{item.subject}</strong><span>{item.text}</span></p>)}<small>Задания видны в МЭШ; статус выполнения ещё сверяется.</small></div>}
          {completeRows.length > 0 && <details className="day-dashboard-homework-complete"><summary><CheckCircle2 size={18} aria-hidden="true" /><span>Сделано · {completeRows.length} {word(completeRows.length, 'предмет', 'предмета', 'предметов')}</span><ChevronDown size={17} aria-hidden="true" /></summary><div>{completeRows.map(homeworkRow)}</div></details>}
        </div> : nextEntry.homework.length ? <div className="day-dashboard-mesh">{nextEntry.homework.map((item, index) => <p key={index}><strong>{item.subject}</strong><span>{item.text}</span></p>)}<small>{nextWork.linkedPage && nextWork.linkedPage.targetDate !== nextDate ? `Запись МЭШ ссылается на урок ${dateLabel(nextWork.linkedPage.targetDate)}.` : 'Точный текст МЭШ · разбор страницы готовится'}</small></div> : <p className="day-dashboard-empty">{nextEntry.complete ? 'На этот учебный день МЭШ пока не показывает домашнего задания.' : 'ДЗ ещё не подтверждено.'} Последняя проверка: {checkedLabel(nextEntry.checkedAt)}.</p>}
        {nextHomeworkToken && <button className="day-dashboard-detail-link" type="button" onClick={() => openDay(nextHomeworkToken, 'homework')}>{nextWork.linkedPage && nextWork.linkedPage.targetDate !== nextDate ? 'Открыть указанное задание' : 'Открыть подробное ДЗ'} <ArrowRight size={17} /></button>}
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
          <p>Последняя проверка МЭШ: {checkedLabel(selectedEntry?.checkedAt ?? null)}{selectedEntry?.checkedAt && ` · ${checkedAge(selectedEntry.checkedAt, now)}`}.</p>
          {parent && selectedPage?.changes?.[0] && (selectedPage.changes[0].added.length > 0 || selectedPage.changes[0].changed.length > 0) && <p>На странице ДЗ добавлено {selectedPage.changes[0].added.length}, уточнено {selectedPage.changes[0].changed.length}.</p>}
          {uploads.some((upload) => upload.status === 'pending') && <p><CheckCircle2 size={15} /> Фото ожидают разбора: {uploads.filter((upload) => upload.status === 'pending').length}.</p>}
          <small>Данные обновляются из Firestore при открытой странице.</small>
        </section>
      </aside>
    </div>
    <p className="day-dashboard-source">Расписание показывает выбранный день; блок ДЗ ниже готовит ближайший следующий учебный день. Работы и тесты обновляются из Firestore.</p>
  </div>
}
