import { useEffect, useMemo, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, Clock3, Sparkles } from 'lucide-react'
import { watchDayPage, watchDayUploads } from '@/lib/dayStore'
import type { DayPageData, DayTask, DayUpload } from '@/lib/dayStore'
import { watchDayDashboard } from '@/lib/dayDashboardStore'
import type { DayDashboardData, IndexedDay } from '@/lib/dayDashboardStore'
import { watchAssignment } from '@/lib/store'
import type { Assignment } from '@/lib/quiz'
import './DayDashboard.css'

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
function taskState(task: DayTask, uploads: DayUpload[], tests: Record<string, Assignment>) {
  if (task.status === 'verified') return 'Проверено'
  if (task.kind === 'written') {
    const photos = uploads.filter((upload) => upload.taskId === task.id)
    if (photos.some((upload) => upload.status === 'pending')) return 'Фото получено · ждёт проверки'
    if (task.status === 'needs-fix') return 'Нужно исправить'
    if (task.status === 'partial') return 'Нужно дополнить'
    if (photos.length) return 'Работа загружена'
    return 'Нужно фото'
  }
  if (task.kind === 'read' && task.testToken) {
    const test = tests[task.testToken]
    if (!test) return 'Нужен тест'
    const answered = Object.values(test.answers ?? {}).filter((answer) => answer !== '' && (!Array.isArray(answer) || answer.length > 0)).length
    return test.status === 'submitted' ? 'Тест отправлен' : answered ? `Тест: ${answered} из ${test.questions.length}` : 'Нужен тест'
  }
  return task.status === 'needs-fix' ? 'Нужно исправить' : 'Статус неизвестен'
}

/**
 * Домашний обзор берёт календарь из dayDashboards, а детали из того же dayPages,
 * что и страница дня. Ответы тестов и фото читаются из их живых документов.
 * @see ../docs/product/dashboard.md#firestore-model
 * @see ../docs/product/dashboard.md#day-navigation
 */
export default function DayDashboard({ token, parent }: { token: string; parent: boolean }) {
  const [index, setIndex] = useState<DayDashboardData>()
  const [page, setPage] = useState<DayPageData>()
  const [uploads, setUploads] = useState<DayUpload[]>([])
  const [tests, setTests] = useState<Record<string, Assignment>>({})
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState('')
  const today = moscowToday()

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
      }, (cause) => setError(cause.message))
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось восстановить вход.') })
    return () => { active = false; stop?.() }
  }, [token, parent])

  const todayEntry = index?.days.find((day) => day.date === today)
  const todayToken = todayEntry?.dayToken
  useEffect(() => {
    setPage(undefined)
    if (!todayToken) return
    return watchDayPage(todayToken, setPage, (cause) => setError(cause.message))
  }, [todayToken])
  const studentToken = page?.studentToken ?? todayToken
  const evidenceTokens = useMemo(() => [...new Set([studentToken, ...(page?.evidenceDayTokens ?? [])].filter((value): value is string => Boolean(value)))], [studentToken, page])
  const evidenceKey = evidenceTokens.join('|')
  useEffect(() => {
    setUploads([])
    if (!evidenceKey) return
    return watchDayUploads(evidenceKey.split('|'), setUploads, (cause) => setError(cause.message))
  }, [evidenceKey])
  const placementKey = (page?.testPlacements ?? []).filter((placement) => (placement.originDate ?? page?.targetDate) === page?.targetDate).map((placement) => placement.token).join('|')
  useEffect(() => {
    setTests({})
    if (!placementKey) return
    return placementKey.split('|').map((testToken) => watchAssignment(testToken, (assignment) => setTests((prior) => ({ ...prior, [testToken]: assignment })), (cause) => setError(cause.message))).reduce<() => void>((stopAll, stop) => () => { stopAll(); stop() }, () => {})
  }, [placementKey])

  const dueDate = page?.targetDate ?? index?.days.find((day) => day.date > today && day.schedule.length)?.date
  const dueEntry = index?.days.find((day) => day.date === dueDate)
  const currentSubjects = page?.subjects.map((subject) => ({ ...subject, tasks: subject.tasks.filter((task) => (task.originDate ?? page.targetDate) === page.targetDate) })).filter((subject) => subject.tasks.length) ?? []
  const chosen = index?.days.find((day) => day.date === selected)
  const gradePriorities = (page?.gradeSummary ?? []).filter((grade) => grade.watch).sort((a, b) => a.average - b.average).slice(0, 3)

  function openDay(day: IndexedDay, tab?: 'homework') {
    if (!day.dayToken) { setSelected(day.date); return }
    sessionStorage.setItem('education-day-dashboard-return', `#/${parent ? 'days-parent' : 'days'}/${token}`)
    if (tab) sessionStorage.setItem('education-day-initial-tab', tab)
    else sessionStorage.removeItem('education-day-initial-tab')
    window.location.hash = `#/${parent ? 'day-parent' : 'day'}/${day.dayToken}`
  }

  if (error && !index) return <div className="day-dashboard-error"><h1>Не получилось открыть dashboard</h1><p>{error}</p></div>
  if (!index) return <p className="day-dashboard-loading">Загружаем dashboard…</p>
  return <div className="day-dashboard">
    {error && <p className="day-dashboard-error" role="alert">{error}</p>}
    <section className="day-dashboard-hero">
      <div className="day-dashboard-kicker">{parent ? 'Панель родителя' : 'Мой план'} · {dateLabel(today, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>{parent ? 'Что сейчас важно' : 'План на сегодня'}</h1>
      <p>{dueDate ? `Ближайшее домашнее задание — к ${dateLabel(dueDate)}. Открой план, чтобы увидеть точные действия и уже загруженные работы.` : 'Ближайший учебный день пока не подтверждён в МЭШ.'}</p>
      {todayEntry?.dayToken && <button type="button" onClick={() => openDay(todayEntry, 'homework')}>Открыть ДЗ {dueDate ? `к ${dateLabel(dueDate)}` : ''} <ArrowRight size={17} /></button>}
    </section>

    <section className="day-dashboard-calendar" aria-label="Выбор дня">
      <div className="day-dashboard-heading"><div><CalendarDays size={20} /><h2>Дни</h2></div><small>Сегодня выделено рамкой</small></div>
      <div className="day-dashboard-dates">{index.days.map((day) => <button key={day.date} type="button" className={`day-dashboard-date ${day.date === today ? 'today' : ''} ${isWeekend(day.date) ? 'weekend' : ''}`} aria-current={day.date === today ? 'date' : undefined} onClick={() => openDay(day)}>
        <span>{dateLabel(day.date, { weekday: 'short' })}</span><strong>{dateLabel(day.date, { day: 'numeric' })}</strong><small>{day.homework.length ? `${day.homework.length} ДЗ` : day.schedule.length ? 'уроки' : '—'}</small>
      </button>)}</div>
      {chosen && <div className="day-dashboard-selected"><div><strong>{dateLabel(chosen.date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong><button type="button" onClick={() => setSelected(undefined)} aria-label="Закрыть выбранный день">×</button></div>
        <p>{chosen.complete ? `${chosen.schedule.length} ${word(chosen.schedule.length, 'урок', 'урока', 'уроков')} по МЭШ. Проверено ${checkedLabel(chosen.checkedAt)}.` : 'МЭШ для этой даты ещё не проверен.'}</p>
        {chosen.schedule.length > 0 && <ul>{chosen.schedule.map((lesson, index) => <li key={`${index}-${lesson.subject}`}>{lessonTime(lesson.start)} · {lesson.subject}</li>)}</ul>}
        {chosen.homework.length ? <><h3>Опубликованное ДЗ</h3><ul>{chosen.homework.map((item, index) => <li key={index}><b>{item.subject}:</b> {item.text}</li>)}</ul></> : <p>ДЗ пока не опубликовано. Последняя проверка: {checkedLabel(chosen.checkedAt)}.</p>}
        <p className="day-dashboard-unprepared">Подробная страница дня ещё не подготовлена. Показана только точная запись МЭШ.</p>
      </div>}
    </section>

    <div className="day-dashboard-grid">
      <section className="day-dashboard-card" aria-label="Ближайшее домашнее задание">
        <div className="day-dashboard-heading"><div><BookOpen size={20} /><h2>Ближайшее ДЗ</h2></div>{dueDate && <small>К {dateLabel(dueDate)}</small>}</div>
        {page && currentSubjects.length ? <div className="day-dashboard-subjects">{currentSubjects.map((subject) => <button key={subject.id} type="button" onClick={() => todayEntry && openDay(todayEntry, 'homework')}>
          <span className="day-dashboard-icon" aria-hidden="true">{subject.icon}</span><span><strong>{subject.name}</strong><small>{subject.tasks.map((task) => taskState(task, uploads, tests)).join(' · ')}</small></span><ArrowRight size={18} />
        </button>)}</div> : dueEntry?.homework.length ? <div className="day-dashboard-mesh">{dueEntry.homework.map((item, index) => <p key={index}><strong>{item.subject}</strong><span>{item.text}</span></p>)}<small>Точный текст МЭШ · разбор страницы готовится</small></div> : <p className="day-dashboard-empty">ДЗ пока не опубликовано. Последняя проверка: {checkedLabel(dueEntry?.checkedAt ?? null)}.</p>}
      </section>
      <aside className="day-dashboard-side">
        <section className="day-dashboard-card"><div className="day-dashboard-heading"><div><Sparkles size={20} /><h2>Оценки</h2></div></div>
          {page?.gradeSummary?.length ? gradePriorities.length ? <ul className="day-dashboard-grades">{gradePriorities.map((grade) => <li key={grade.id}><span>{grade.name}</span><strong>{grade.average.toFixed(2).replace('.', ',')}</strong></li>)}</ul> : <p>По текущему срезу всё спокойно ✨</p> : <p>Срез оценок ещё не опубликован.</p>}
          {page?.gradeAsOf && <small>Срез на {dateLabel(page.gradeAsOf.slice(0, 10))}. Условные сценарии — в странице дня.</small>}
        </section>
        <section className="day-dashboard-card"><div className="day-dashboard-heading"><div><Clock3 size={20} /><h2>Синхронизация</h2></div></div>
          <p>МЭШ за сегодня: {checkedLabel(todayEntry?.checkedAt ?? null)}.</p>
          {parent && page?.changes?.[0] && <p>В последнем обновлении: добавлено {page.changes[0].added.length}, уточнено {page.changes[0].changed.length}.</p>}
          {uploads.some((upload) => upload.status === 'pending') && <p><CheckCircle2 size={15} /> Фото ожидают разбора: {uploads.filter((upload) => upload.status === 'pending').length}.</p>}
          <small>Данные обновляются из Firestore при открытой странице.</small>
        </section>
      </aside>
    </div>
    <p className="day-dashboard-source"><ArrowLeft size={14} /> Страница дня, тесты и загруженные фото используют те же документы Firestore.</p>
  </div>
}
