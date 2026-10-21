/** @see ../docs/decisions/collapsed-variant-status-2026-10-21.md */
/**
 * @see ../docs/product/school-day.md
 */
/** @see ../docs/modules/school-diary/dashboard.md#compact-homework */
/** @see ../docs/modules/materials/material-clarification.md */
/** @see ../docs/decisions/pupil-vacations-2026-10-19.md */
import { useEffect, useRef, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { ArrowRight, CalendarDays, ChevronDown, Clock3, Hourglass, Sparkles, Timer } from 'lucide-react'
import { watchDayPage } from '@/lib/dayStore'
import type { DayPageData } from '@/lib/dayStore'
import { clearCachedDayDashboard, readCachedDayDashboard, watchDayDashboard } from '@/lib/dayDashboardStore'
import type { DayDashboardData } from '@/lib/dayDashboardStore'
import { lessonSubjectId, lessonWorkItems, requiredQuizRequirement } from '@/lib/homeworkStatus'
import { quizTaskForPlacement, withQuizPlacements } from '@/lib/quizCardViewModel'
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
import StatusIcon from './components/StatusIcon'
import HomeworkOverview from './components/HomeworkOverview'
import GradeAverage, { gradeAverageTone } from './components/GradeAverage'
import DayCalendar, { vacationRange } from './components/DayCalendar'
import { vacationOn } from '../day/school-calendar.mjs'

function moscowToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`))
}
function checkedLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(value)) : 'ещё не проверяли'
}
/** @see ../docs/modules/school-diary/dashboard.md#sync-freshness */
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
function lessonTime(iso: string) {
  if (!iso) return ''
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(time)
}
/** @see ../docs/modules/school-diary/dashboard.md#lesson-countdowns */
function remainingLessonTime(target: number, now: number) {
  const minutes = Math.max(1, Math.ceil((target - now) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${minutes} мин`
}
/**
 * Домашний обзор берёт календарь из dayDashboards, а детали из того же dayPages,
 * что и страница дня. Ответы тестов и фото читаются из их живых документов.
 * @see ../docs/modules/school-diary/dashboard.md#firestore-model
 * @see ../docs/modules/school-diary/dashboard.md#day-navigation
 * @see ../docs/modules/school-diary/grades.md#dashboard-grade-list
 */
/** @see ../docs/shared/design/README.md#cards-and-status */
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
  const [pastLessonsOverride, setPastLessonsOverride] = useState<{ date: string; open: boolean } | null>(null)
  const [seenUpdates, setSeenUpdates] = useState<Set<string>>(() => new Set())
  const [selectedGrade, setSelectedGrade] = useState<{ subjectId: string; index: number } | null>(null)
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
    sessionStorage.setItem('education-day-dashboard-return', `#/days/${index?.canonicalToken ?? token}`)
    sessionStorage.setItem('education-day-initial-tab', 'homework')
    sessionStorage.setItem('education-day-focus-task', JSON.stringify({ dayToken: homeworkToken, taskId }))
    window.location.hash = `#/day/${index?.dayCanonicalTokens?.[homeworkToken] ?? homeworkToken}`
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
    const placements = (nextWork.page?.testPlacements ?? []).filter((placement) => placement.subjectId === subject.id && (placement.originDate ?? nextDate) === nextDate)
    const tasks = withQuizPlacements(subject.tasks, placements)
    const items = lessonWorkItems(tasks, nextWork.uploads, nextWork.reviews, nextWork.parentDecisions.events, nextWork.tests, nextWork.scores)
    const standalone = placements.filter((placement) => !quizTaskForPlacement(subject.tasks, placements, placement) && !nextWork.tests[placement.token]?.linkedToTestId)
      .flatMap((placement) => {
        const requirement = requiredQuizRequirement(placement.token, nextWork.tests, nextWork.scores)
        return requirement ? [{ id: `quiz:${placement.token}`, title: nextWork.tests[placement.token]?.title ?? 'Самопроверка', ...requirement }] : []
      })
    items.push(...standalone)
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
  const gradeSource = gradeToken && gradeState && gradeState.token === gradeToken ? gradeState.page
    : gradeToken ? readCachedGrades(role, token, gradeToken) : null
  useEffect(() => {
    if (gradeState && gradeState.token === gradeToken && gradeToken) writeCachedGrades(role, token, gradeToken, gradeState.page)
  }, [gradeState, gradeToken, role, token])
  const gradeRows = gradeSource?.gradeSummary ?? []
  const gradeDetails = new Map((gradeSource?.grades ?? []).map((item) => [item.id, item]))

  /** @see ../docs/modules/school-diary/dashboard.md#dashboard-warm-start */
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
    const subjectPlacements = (selectedPage?.testPlacements ?? []).filter((placement) => (placement.originDate ?? selectedDate) === selectedDate && placement.subjectId === subjectId)
    const tasks = withQuizPlacements(subject?.tasks ?? [], subjectPlacements)
    const taskItems = lessonWorkItems(tasks, uploads, reviews, parentDecisions.events, tests, scores)
    const placementItems: LessonWorkItem[] = subjectPlacements.filter((placement) => !quizTaskForPlacement(subject?.tasks ?? [], subjectPlacements, placement) && !tests[placement.token]?.linkedToTestId).flatMap((placement) => {
      const test = tests[placement.token]
      const requirement = requiredQuizRequirement(placement.token, tests, scores)
      return requirement ? [{ id: `quiz:${placement.token}`, title: test?.title ?? 'Самопроверка', ...requirement }] : []
    })
    const liveItems = [...taskItems, ...placementItems]
    const optionalOnly = !liveItems.length && subjectPlacements.some((placement) => tests[placement.token]?.familyOptional)
    const liveReferenceTask = subject?.tasks.find((task) => task.referenceDate)
    const done = liveItems.filter((item) => item.state === 'done').length
    const checking = liveItems.filter((item) => item.state === 'checking').length
    const unclear = liveItems.filter((item) => item.state === 'unclear').length
    const liveTone = liveItems.length ? checking ? 'checking' : unclear ? 'unclear' : done === liveItems.length ? 'complete' : done ? 'partial' : 'empty' : liveReferenceTask ? 'reference' : optionalOnly ? 'optional' : rawHomework.length ? 'assigned' : selectedEntry.complete && (selectedPage || selectedDate <= today) ? 'none' : 'unknown'
    const liveBadge = liveItems.length ? `${done} из ${liveItems.length}` : liveReferenceTask?.referenceDate ? `См. ${dateLabel(liveReferenceTask.referenceDate)}` : liveTone === 'optional' ? 'Самопроверка' : liveTone === 'none' ? '⸻' : liveTone === 'assigned' ? 'Задано' : 'Уточняем'
    const key = lessonCacheKey(lesson.start, lesson.subject)
    const cached = savedLessons.get(key)
    const shown = selectedWork.ready ? { key, tone: liveTone, badge: liveBadge, items: liveItems,
      referenceDate: liveReferenceTask?.referenceDate, referenceText: liveReferenceTask?.meshText } : cached
    const shownItems = shown?.items ?? []
    const referenceDate = shown?.referenceDate
    const referenceToken = referenceDate ? index?.days.find((day) => day.date === referenceDate)?.homeworkDayToken : null
    return { lesson, subject, rawHomework, updatedAt, updateKey, newlyAssigned,
      items: shownItems, tone: shown?.tone ?? 'unknown', badge: shownItems.length ? `${shownItems.filter((item) => item.state === 'done').length} из ${shownItems.length}` : shown?.tone === 'none' ? '⸻' : shown?.tone === 'optional' ? 'Самопроверка' : shown?.badge ?? 'Уточняем',
      referenceDate, referenceText: shown?.referenceText, referenceToken, key }
  }) ?? []
  /** @see ../docs/modules/school-diary/dashboard.md#progressive-schedule */
  const scheduleFinished = lessonRows.length > 0 && lessonRows.every(({ lesson }) => {
    const end = Date.parse(lesson.end)
    return Number.isFinite(end) && now >= end
  })
  const scheduleCollapsed = focusSubject ? false : scheduleOverride?.date === selectedDate ? !scheduleOverride.open : scheduleFinished
  const finishedLessonRows = lessonRows.filter(({ lesson }) => {
    const end = Date.parse(lesson.end)
    return Number.isFinite(end) && now >= end
  })
  const groupFinishedLessons = selectedDate === today && !scheduleFinished && finishedLessonRows.length > 0
  const focusSubjectId = lessonSubjectId(focusSubject)
  const focusIsFinished = groupFinishedLessons && finishedLessonRows.some(({ lesson }) => lesson.subject === focusSubject || focusSubjectId != null && lessonSubjectId(lesson.subject) === focusSubjectId)
  const pastLessonsExpanded = focusIsFinished || pastLessonsOverride?.date === selectedDate && pastLessonsOverride.open
  const visibleLessonRows = groupFinishedLessons ? lessonRows.filter(({ lesson }) => {
    const end = Date.parse(lesson.end)
    return !Number.isFinite(end) || now < end
  }) : lessonRows
  /** @see ../docs/modules/school-diary/dashboard.md#lesson-countdowns — only the nearest future lesson gets a waiting timer. */
  const nearestStart = selectedDate === today ? Math.min(...lessonRows.map(({ lesson }) => Date.parse(lesson.start)).filter((start) => Number.isFinite(start) && start > now)) : Infinity
  const nextLesson = Number.isFinite(nearestStart) ? lessonRows.find(({ lesson }) => Date.parse(lesson.start) === nearestStart)?.lesson : undefined
  /** @see ../docs/modules/school-diary/dashboard.md#progressive-schedule */
  useEffect(() => {
    if (!focusSubject || !selectedEntry) return
    const subjectId = lessonSubjectId(focusSubject)
    const target = [...document.querySelectorAll<HTMLElement>('.day-dashboard-lesson')].find((element) => element.dataset.subject === focusSubject || subjectId != null && lessonSubjectId(element.dataset.subject ?? '') === subjectId)
    if (!target) return
    if (target instanceof HTMLDetailsElement) target.open = true
    acknowledgeHomeworkUpdate(selectedDate, target.dataset.subject ?? focusSubject)
    setScheduleOverride({ date: selectedDate, open: true })
    if (focusIsFinished) setPastLessonsOverride({ date: selectedDate, open: true })
    target.scrollIntoView({ behavior: 'auto', block: 'start' })
    sessionStorage.removeItem('education-dashboard-focus-subject')
    setFocusSubject('')
  }, [focusSubject, focusIsFinished, selectedEntry, selectedDate])

  function renderLesson({ lesson, subject, rawHomework, updatedAt, newlyAssigned, items, tone, badge, referenceDate, referenceText, referenceToken }: typeof lessonRows[number], lessonIndex: number) {
    const start = Date.parse(lesson.start)
    const end = Date.parse(lesson.end)
    const underway = selectedDate === today && Number.isFinite(start) && Number.isFinite(end) && end > start && start <= now && now < end
    const awaiting = selectedDate === today && lesson === nextLesson && !underway
    const countdown = underway ? remainingLessonTime(end, now) : awaiting ? remainingLessonTime(start, now) : ''
    const countdownLabel = underway ? `До конца урока ${countdown}` : `Начнётся через ${countdown}`
    return <li key={`${selectedDate}-${lessonIndex}-${lesson.subject}`}><details data-subject={lesson.subject} className={`day-dashboard-lesson day-dashboard-lesson-${tone}${newlyAssigned ? ' has-new-homework' : ''}`}>
      <summary onClick={() => {
        acknowledgeHomeworkUpdate(selectedDate, lesson.subject)
      }}>{/* @see ../docs/shared/design/README.md#mobile-card-headings */}<time>{lessonTime(lesson.start)}</time><span className="day-dashboard-lesson-name">{lesson.subject}{countdown && <span className={`day-dashboard-lesson-phase ${underway ? 'current' : 'waiting'}`} aria-label={countdownLabel} title={countdownLabel}>{underway ? <Timer size={14} aria-hidden="true" /> : <Hourglass size={14} aria-hidden="true" />}{countdown}</span>}{newlyAssigned && <span className="day-dashboard-lesson-new"><StatusIcon status="new" size={12} />Новое ДЗ</span>}</span><span className="day-dashboard-lesson-badge" aria-label={referenceDate ? `См. ДЗ за ${dateLabel(referenceDate)}` : tone === 'none' ? 'ДЗ не задано на последней сверке МЭШ' : tone === 'checking' ? `${badge}, проверяем` : tone === 'unclear' ? `${badge}, критерий неясен` : undefined}>{!referenceDate && tone !== 'none' && <StatusIcon size={13} status={tone === 'complete' ? 'complete' : tone === 'partial' ? 'partial' : tone === 'checking' ? 'waiting' : tone === 'unclear' || tone === 'unknown' ? 'unknown' : 'ready'} />}{referenceDate ? `ДЗ ${dateLabel(referenceDate, { day: 'numeric', month: '2-digit' })}` : badge}<ChevronDown size={15} aria-hidden="true" /></span></summary>
      <div className="day-dashboard-lesson-body">{subject?.tasks.some((task) => task.dueDate && task.dueDate !== (task.lessonDate ?? selectedDate)) && <p className="day-dashboard-lesson-update">Срок сдачи: {dateLabel(subject.tasks.find((task) => task.dueDate && task.dueDate !== (task.lessonDate ?? selectedDate))!.dueDate!)} · по записи МЭШ. Задание относится к этому уроку.</p>}{items.length ? <div className="day-dashboard-lesson-items">{items.map((item) => <div className={`day-dashboard-lesson-item ${item.state}`} key={item.id}><span className="day-dashboard-lesson-item-symbol" aria-hidden="true"><StatusIcon size={15} status={item.state === 'done' ? 'complete' : item.state === 'checking' ? 'waiting' : item.state === 'unclear' ? 'unknown' : 'ready'} /></span><div><strong>{item.state === 'done' ? 'Сделано' : item.state === 'checking' ? 'Проверяем' : item.state === 'unclear' ? 'Разобрано' : 'Осталось'}: {item.title}</strong><span>{item.detail}</span>{homeworkToken && <button type="button" onClick={() => openDay(homeworkToken, 'homework', item.id, { date: selectedDate, subject: lesson.subject })}>{item.state === 'todo' ? 'Перейти к заданию' : item.state === 'checking' ? 'Открыть работу' : 'Результат'} <ArrowRight size={14} aria-hidden="true" /></button>}</div></div>)}</div>
        : referenceDate ? <div className="day-dashboard-lesson-raw"><p>{referenceText}</p><small>Это ссылка на уже назначенное ДЗ. Второй раз выполнять его не нужно.</small>{referenceToken && <button type="button" onClick={() => openDay(referenceToken, 'homework')}>Открыть ДЗ за {dateLabel(referenceDate)} <ArrowRight size={14} aria-hidden="true" /></button>}</div>
        : tone === 'optional' ? <div className="day-dashboard-lesson-raw"><p>Результат самопроверки учитывается отдельно от школьного задания.</p>{homeworkToken && <button type="button" onClick={() => openDay(homeworkToken, 'homework')}>Открыть тест <ArrowRight size={14} aria-hidden="true" /></button>}</div>
        : rawHomework.length ? <div className="day-dashboard-lesson-raw">{rawHomework.map((item, rawIndex) => <p key={rawIndex}>{item.text}</p>)}<small>Точный разбор задания ещё готовится.</small>{homeworkToken && <button type="button" onClick={() => openDay(homeworkToken, 'homework')}>Открыть ДЗ <ArrowRight size={14} aria-hidden="true" /></button>}</div>
          : <p>{tone === 'none' ? 'На последней сверке МЭШ домашнее задание к этому уроку не задано.' : 'Сведения о домашнем задании ещё уточняются.'}</p>}{newlyAssigned && <p className="day-dashboard-lesson-update">ДЗ обновлено: {checkedLabel(updatedAt ?? null)}.</p>}<small>Последняя сверка МЭШ: {checkedLabel(selectedEntry?.checkedAt ?? null)}.</small></div>
    </details></li>
  }

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
  /** @see ../docs/modules/school-diary/dashboard.md#homework-updates */
  function acknowledgeHomeworkUpdate(date: string, subject: string) {
    const entry = index?.days.find((day) => day.date === date)
    const at = entry?.homeworkUpdate?.at
    const subjectId = lessonSubjectId(subject)
    if (!at || !entry.homeworkUpdate?.subjects.some((name) => name.toLocaleLowerCase('ru-RU') === subject.toLocaleLowerCase('ru-RU')
      || subjectId != null && lessonSubjectId(name) === subjectId)) return
    const key = homeworkUpdateKey(token, date, subject, at)
    if (seenUpdates.has(key) || wasHomeworkUpdateSeen(key)) return
    markHomeworkUpdateSeen(key)
    setSeenUpdates((current) => new Set(current).add(key))
    window.dispatchEvent(new CustomEvent('education-homework-update-seen', {
      detail: { dashboardToken: token, date, subject },
    }))
  }
  function openDay(dayToken: string, tab?: 'homework', taskId?: string, viewed?: { date: string; subject: string }) {
    if (viewed) acknowledgeHomeworkUpdate(viewed.date, viewed.subject)
    sessionStorage.setItem('education-day-dashboard-return', `#/days/${index?.canonicalToken ?? token}`)
    if (tab) sessionStorage.setItem('education-day-initial-tab', tab)
    else sessionStorage.removeItem('education-day-initial-tab')
    if (taskId) sessionStorage.setItem('education-day-focus-task', JSON.stringify({ dayToken, taskId }))
    else sessionStorage.removeItem('education-day-focus-task')
    window.location.hash = `#/day/${index?.dayCanonicalTokens?.[dayToken] ?? dayToken}`
  }

  if (error === DATA_UPDATE_MESSAGE) return <DataCompatibilityNotice />
  if (error && !index) return <div className="day-dashboard-error"><h1>Не получилось открыть dashboard</h1><p>{error}</p></div>
  if (!index) return <p className="day-dashboard-loading">Загружаем dashboard…</p>
  const selectedVacation = vacationOn(index.schoolCalendar, selectedDate)
  return <div className="day-dashboard">
    {error && <p className="day-dashboard-error" role="alert">{error}</p>}
    <DayCalendar days={index.days} schoolCalendar={index.schoolCalendar} today={today} selectedDate={selectedDate} onSelect={chooseDay} stripRef={datesRef} />

    <div className={`day-dashboard-selected-heading${parent ? ' parent' : ''}`}>{personalParent && <a className="day-dashboard-parent-home" href="#/">← Все дети</a>}<div className="day-dashboard-kicker">{parent ? 'Панель родителя' : 'Мой план'} · выбранный день</div><h1>{dateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</h1></div>

    {weekendWorks.map((slot) => <WeekendMathSlot key={`${slot.dayToken}:${slot.taskIds.join(',')}`} token={slot.dayToken} taskIds={slot.taskIds} parent={parent} lessonDate={slot.lessonDate} dueDate={slot.dueDate} title={slot.title} />)}

    <div className="day-dashboard-grid">
      <div className="day-dashboard-main">
      <section className="day-dashboard-card" aria-label="Расписание выбранного дня" data-collapsed={scheduleCollapsed}>
        <div className="day-dashboard-heading"><div><CalendarDays size={20} /><h2>Расписание</h2></div><small>{dateLabel(selectedDate)}<br />{selectedVacation && !selectedEntry?.checkedAt ? 'Календарь МЭШ' : 'МЭШ проверен'}: {checkedLabel(selectedEntry?.checkedAt ?? (selectedVacation ? index.schoolCalendar?.checkedAt : null) ?? null)}</small></div>
        {Boolean(selectedEntry?.schedule.length) && <button className="day-dashboard-schedule-toggle" type="button" aria-expanded={!scheduleCollapsed} onClick={() => setScheduleOverride({ date: selectedDate, open: scheduleCollapsed })}>{scheduleCollapsed ? `Показать уроки · ${lessonRows.length}` : 'Свернуть расписание'} <ChevronDown size={16} aria-hidden="true" /></button>}
        {!scheduleCollapsed && (selectedEntry?.schedule.length ? <div className="day-dashboard-lesson-groups">
          {groupFinishedLessons && <div className="day-dashboard-past-group">
            <button className="day-dashboard-past-toggle" type="button" aria-expanded={pastLessonsExpanded} aria-label={`Прошедшие уроки: ${finishedLessonRows.map(({ lesson }) => lesson.subject).join(', ')}`} onClick={() => setPastLessonsOverride({ date: selectedDate, open: !pastLessonsExpanded })}>
              <strong>Прошли · {finishedLessonRows.length}</strong><span>{finishedLessonRows.map(({ lesson }) => lesson.subject).join(', ')}</span><ChevronDown size={16} aria-hidden="true" />
            </button>
            {pastLessonsExpanded && <ul className="day-dashboard-lessons day-dashboard-past-lessons">{finishedLessonRows.map(renderLesson)}</ul>}
          </div>}
          <ul className="day-dashboard-lessons day-dashboard-current-lessons">{visibleLessonRows.map(renderLesson)}</ul>
        </div> : <p className="day-dashboard-empty">{selectedVacation ? `Каникулы · ${vacationRange(selectedVacation)}. По календарю МЭШ.` : selectedEntry?.complete ? 'Уроков на эту дату нет.' : `Расписание ещё не подтверждено. Последняя проверка: ${checkedLabel(selectedEntry?.checkedAt ?? null)}.`}</p>)}
        {!scheduleCollapsed && selectedEntry?.dayToken && <button className="day-dashboard-detail-link" type="button" onClick={() => openDay(selectedEntry.dayToken!)}>Открыть подробное расписание <ArrowRight size={17} /></button>}
      </section>
      <HomeworkOverview date={nextEntry ? nextDate : undefined} rows={homeworkRows} unconfirmed={unprojectedHomework}
        onOpen={(row, taskId) => nextHomeworkToken && openDay(nextHomeworkToken, 'homework', taskId, { date: nextDate, subject: row.subject.name })}
        onOpenAll={nextHomeworkToken ? () => openDay(nextHomeworkToken, 'homework') : undefined}
        openAllLabel={nextWork.linkedPage && nextWork.linkedPage.targetDate !== nextDate ? 'Указанное задание' : 'Все задания'}
        fallback={!nextEntry ? <p className="day-dashboard-empty">Дата следующего ДЗ пока неизвестна.</p>
          : nextEntry.homework.length ? <div className="day-dashboard-mesh">{nextEntry.homework.map((item, index) => <p key={index}><strong>{item.subject}</strong><span>{item.text}</span></p>)}<small>{nextWork.linkedPage && nextWork.linkedPage.targetDate !== nextDate ? `МЭШ ссылается на ${dateLabel(nextWork.linkedPage.targetDate)}.` : 'Разбор готовится'}</small></div>
            : <p className="day-dashboard-empty">{nextEntry.complete ? 'В МЭШ пока нет заданий на эту дату.' : 'ДЗ ещё не подтверждено.'} Проверено: {checkedLabel(nextEntry.checkedAt)}.</p>}
      />
      </div>
      <aside className="day-dashboard-side">
        <section className="day-dashboard-card" aria-label="Оценки по предметам"><div className="day-dashboard-heading"><div><Sparkles size={20} /><h2>Оценки</h2></div>{gradeRows.length > 0 && <small>{gradeRows.length} {word(gradeRows.length, 'предмет', 'предмета', 'предметов')}</small>}</div>
          {gradeRows.length ? <div className="day-dashboard-grades">{gradeRows.map((grade) => {
            const marks = gradeDetails.get(grade.id)?.grades ?? []
            return <details key={grade.id} className="day-dashboard-grade"><summary><span>{grade.name}</span><GradeAverage value={grade.average.toFixed(2).replace('.', ',')} tone={gradeAverageTone(grade.average, grade.watch, grade.allFives)} excellent={grade.allFives} /><ChevronDown size={16} aria-hidden="true" /></summary>
              <div className="day-dashboard-grade-detail">{marks.length ? <><p>{marks.length} {word(marks.length, 'оценка', 'оценки', 'оценок')} в сохранённом срезе:</p><ul>{marks.map(({ mark, weight, date }, index) => <li key={`${index}-${mark}-${weight}`} className={`mark-${mark}`}><button type="button" aria-label={`Оценка ${mark}, вес ${weight}${date ? `, ${dateLabel(date)}` : ''}. Показать, за что поставлена`} aria-expanded={selectedGrade?.subjectId === grade.id && selectedGrade.index === index} onClick={() => setSelectedGrade((current) => current?.subjectId === grade.id && current.index === index ? null : { subjectId: grade.id, index })}>{mark}{weight !== 1 && <small>вес {weight}</small>}</button></li>)}</ul>{selectedGrade?.subjectId === grade.id && marks[selectedGrade.index] && <div className="day-dashboard-mark-detail" role="region" aria-label={`Подробности оценки ${marks[selectedGrade.index].mark}`}>
                {marks[selectedGrade.index].date && <span>{dateLabel(marks[selectedGrade.index].date!)}</span>}
                <strong>{marks[selectedGrade.index].workType || 'Вид работы в МЭШ не указан'}</strong>
                {marks[selectedGrade.index].comment && <p>Комментарий учителя: {marks[selectedGrade.index].comment}</p>}
                {!marks[selectedGrade.index].date && !marks[selectedGrade.index].workType && !marks[selectedGrade.index].comment && <small>Подробности этой оценки пока не сохранены.</small>}
              </div>}</> : <p>Список оценок для этого предмета пока не сохранён.</p>}</div>
            </details>
          })}</div> : <p>Срез оценок ещё не опубликован.</p>}
          {gradeSource?.gradeAsOf && <p className="day-dashboard-grade-asof">Сохранённый срез МЭШ на {dateLabel(gradeSource.gradeAsOf.slice(0, 10))}. Новые оценки появятся после синхронизации, не при открытии страницы.</p>}
        </section>
        <section className="day-dashboard-card"><div className="day-dashboard-heading"><div><Clock3 size={20} /><h2>Синхронизация</h2></div></div>
          <p>Последняя проверка МЭШ: {checkedLabel(selectedEntry?.checkedAt ?? null)}{selectedEntry?.checkedAt && ` · ${checkedAge(selectedEntry.checkedAt, now)}`}.</p>
          {parent && selectedPage?.changes?.[0] && (selectedPage.changes[0].added.length > 0 || selectedPage.changes[0].changed.length > 0) && <p>На странице ДЗ добавлено {selectedPage.changes[0].added.length}, уточнено {selectedPage.changes[0].changed.length}.</p>}
          {uploads.some((upload) => upload.status === 'pending') && <p><StatusIcon status="waiting" size={15} /> Фото ожидают разбора: {uploads.filter((upload) => upload.status === 'pending').length}.</p>}
          <small>Новые результаты появляются без перезагрузки.</small>
        </section>
      </aside>
    </div>
  </div>
}
