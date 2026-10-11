import { useEffect, useMemo, useState } from 'react'
import { watchDayDashboard } from './dayDashboardStore'
import type { DayDashboardData, IndexedDay } from './dayDashboardStore'
import { watchDayPage, watchDayReviews, watchDayUploads, watchEvidenceDayPages, withVerifiedPlatformResult } from './dayStore'
import type { DayPageData, DayUpload, DayWorkReview } from './dayStore'
import { useParentCompletions } from './useParentCompletions'
import { lessonWorkItems } from './homeworkStatus'
import type { LessonWorkItem, QuizScore } from './homeworkStatus'
import { loadAnswerKey, watchAssignment } from './store'
import { grade } from './quiz'
import type { Assignment } from './quiz'

export type ParentSubjectOverview = {
  id: string
  name: string
  state: 'done' | 'todo' | 'checking' | 'unclear'
  items: LessonWorkItem[]
}
export type ParentChildOverview = {
  state: 'loading' | 'unknown' | 'none' | 'ready'
  day: IndexedDay | null
  subjects: ParentSubjectOverview[]
  done: number
  checking: number
  todo: number
  unclear: number
  total: number
  weekendCards: number
  reason: string
  error: string
}

function moscowToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function nearestDay(index: DayDashboardData | null, today: string): IndexedDay | null {
  if (!index) return null
  const upcoming = index.days.filter((day) => day.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  return upcoming.find((day) => day.homework.length > 0) ?? upcoming.find((day) => day.schedule.length > 0) ?? upcoming[0] ?? null
}
function subjectState(items: LessonWorkItem[]): ParentSubjectOverview['state'] {
  return items.some((item) => item.state === 'todo') ? 'todo'
    : items.some((item) => item.state === 'unclear') ? 'unclear'
      : items.some((item) => item.state === 'checking') ? 'checking' : 'done'
}

/**
 * Reuses the same evidence and task classifier as the day dashboard. Until every
 * required live stream has produced a snapshot, the parent sees "Уточняем",
 * never a made-up 0/N or a premature "Всё готово".
 * @see ../../docs/architecture/family-data-model.md#parent-home
 * @see ../../docs/product/dashboard.md#homework-progress
 */
export function useParentChildOverview(dashboardToken: string): ParentChildOverview {
  const [index, setIndex] = useState<DayDashboardData | null>(null)
  const [indexReady, setIndexReady] = useState(false)
  const [error, setError] = useState('')
  const [today, setToday] = useState(moscowToday)

  useEffect(() => {
    const timer = window.setInterval(() => setToday(moscowToday()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return watchDayDashboard(dashboardToken, (data) => {
      if (data.kind !== 'parent') { setError('Для ребёнка не опубликован родительский календарь.'); setIndexReady(true); return }
      setIndex(data)
      setIndexReady(true)
      setError('')
    }, (cause) => { setError(cause.message); setIndexReady(true) })
  }, [dashboardToken])

  const day = nearestDay(index, today)
  const weekendCards = index?.weekendWork?.filter((slot) => slot.dates.includes(today)).length ?? 0
  const dayToken = day?.homeworkDayToken ?? null
  const [pageSnapshot, setPageSnapshot] = useState<{ token: string; page: DayPageData } | null>(null)
  useEffect(() => {
    if (!dayToken) return
    return watchDayPage(dayToken, (page) => setPageSnapshot({ token: dayToken, page }), (cause) => setError(cause.message))
  }, [dayToken])
  const page = pageSnapshot?.token === dayToken && pageSnapshot.page.targetDate === day?.date && pageSnapshot.page.kind === 'parent' ? pageSnapshot.page : null
  const studentToken = page ? page.studentToken ?? dayToken : null
  const evidenceTokens = useMemo(() => [...new Set([studentToken, ...(page?.evidenceDayTokens ?? [])].filter((value): value is string => Boolean(value)))], [studentToken, page])
  const evidenceKey = evidenceTokens.join('|')
  const [uploadSnapshot, setUploadSnapshot] = useState<{ key: string; items: DayUpload[] } | null>(null)
  const [reviewSnapshot, setReviewSnapshot] = useState<{ key: string; items: DayWorkReview[] } | null>(null)
  const [pageEvidenceSnapshot, setPageEvidenceSnapshot] = useState<{ key: string; pages: DayPageData[] } | null>(null)
  const decisions = useParentCompletions(evidenceKey, Boolean(page))
  useEffect(() => {
    if (!evidenceKey) return
    return watchDayUploads(evidenceTokens, (items) => setUploadSnapshot({ key: evidenceKey, items }), (cause) => setError(cause.message))
  }, [evidenceKey, evidenceTokens])
  useEffect(() => {
    if (!evidenceKey) return
    return watchDayReviews(evidenceTokens, (items) => setReviewSnapshot({ key: evidenceKey, items }), (cause) => setError(cause.message), true)
  }, [evidenceKey, evidenceTokens])
  useEffect(() => {
    if (!evidenceKey) return
    return watchEvidenceDayPages(evidenceTokens, (pages) => setPageEvidenceSnapshot({ key: evidenceKey, pages }), (cause) => setError(cause.message))
  }, [evidenceKey, evidenceTokens])

  const testTokens = useMemo(() => [...new Set([
    ...(page?.subjects.flatMap((subject) => subject.tasks.map((task) => task.testToken)) ?? []),
    ...(page?.testPlacements?.filter((placement) => (placement.originDate ?? day?.date) === day?.date).map((placement) => placement.token) ?? []),
  ].filter((value): value is string => Boolean(value)))], [page, day?.date])
  const testKey = testTokens.join('|')
  const loadKey = `${dashboardToken}|${day?.date ?? ''}|${dayToken ?? ''}|${evidenceKey}|${testKey}`
  const [expiredKey, setExpiredKey] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setExpiredKey(loadKey), 15_000)
    return () => window.clearTimeout(timer)
  }, [loadKey])
  const loadingExpired = expiredKey === loadKey
  const [testSnapshot, setTestSnapshot] = useState<{ key: string; items: Record<string, { assignment: Assignment; score?: QuizScore; scoreReady: boolean }> } | null>(null)
  useEffect(() => {
    if (!testKey) return
    let active = true
    const items: Record<string, { assignment: Assignment; score?: QuizScore; scoreReady: boolean }> = {}
    const emit = () => { if (active) setTestSnapshot({ key: testKey, items: { ...items } }) }
    const stops = testTokens.map((token) => watchAssignment(token, (assignment) => {
      items[token] = { assignment, scoreReady: assignment.status !== 'submitted' }
      emit()
      if (assignment.status !== 'submitted') return
      void loadAnswerKey(token).then((key) => {
        if (!active || items[token]?.assignment !== assignment) return
        const results = grade(assignment, key)
        const score = results.some((result) => result.points == null) ? undefined : {
          points: results.reduce((sum, result) => sum + (result.points ?? 0), 0),
          maxPoints: assignment.questions.reduce((sum, question) => sum + question.points, 0),
        }
        items[token] = { assignment, score, scoreReady: true }
        emit()
      }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать результат теста.') })
    }, (cause) => setError(cause.message)))
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [testKey, testTokens])

  const blank: ParentChildOverview = { state: 'loading', day, subjects: [], done: 0, checking: 0, todo: 0, unclear: 0, total: 0, weekendCards, reason: '', error }
  if (error) return { ...blank, state: 'unknown', reason: 'Сведения не удалось сверить. Откройте календарь для подробностей.' }
  if (!indexReady) return loadingExpired ? { ...blank, state: 'unknown', reason: 'Календарь пока не загрузился. Проверьте связь и откройте календарь ребёнка.' } : blank
  if (!day) return { ...blank, state: 'unknown', reason: 'Ближайшие учебные дни ещё не загружены.' }
  if (!dayToken || !page) {
    if (day.complete && day.homework.length === 0) return { ...blank, state: 'none', reason: 'На последней сверке ДЗ не было; оно может появиться позже.' }
    return { ...blank, state: 'unknown', reason: day.homework.length ? 'ДЗ найдено в МЭШ; подробный план ещё готовится.' : 'ДЗ на этот день ещё уточняется.' }
  }
  if (decisions.error) return { ...blank, state: 'unknown', reason: 'Не удалось получить решения взрослого. Откройте календарь для подробностей.' }
  if (!evidenceKey || uploadSnapshot?.key !== evidenceKey || reviewSnapshot?.key !== evidenceKey || pageEvidenceSnapshot?.key !== evidenceKey || !decisions.ready) {
    return { ...blank, state: loadingExpired ? 'unknown' : 'loading', reason: loadingExpired ? 'Не удалось получить все результаты. Откройте календарь ребёнка для подробностей.' : 'Загружаем работы и результаты.' }
  }
  if (testKey && (testSnapshot?.key !== testKey || testTokens.some((token) => !testSnapshot.items[token]?.scoreReady))) {
    return { ...blank, state: loadingExpired ? 'unknown' : 'loading', reason: loadingExpired ? 'Не удалось получить все результаты тестов. Откройте календарь ребёнка.' : 'Загружаем результаты тестов.' }
  }
  const uploads = uploadSnapshot.items
  const reviews = reviewSnapshot.items
  const evidencePages = pageEvidenceSnapshot.pages
  const tests = Object.fromEntries(testTokens.map((token) => [token, testSnapshot?.items[token]?.assignment]).filter((pair) => pair[1])) as Record<string, Assignment>
  const scores = Object.fromEntries(testTokens.map((token) => [token, testSnapshot?.items[token]?.score]).filter((pair) => pair[1])) as Record<string, QuizScore>
  const subjects: ParentSubjectOverview[] = page.subjects.filter((subject) => subject.tasks.some((task) => (task.originDate ?? day.date) === day.date)).map((subject) => {
    const tasks = subject.tasks.filter((task) => (task.originDate ?? day.date) === day.date).map((task) => withVerifiedPlatformResult(task, day.date, evidencePages))
    const items = lessonWorkItems(tasks, uploads, reviews, decisions.events, tests, scores)
    const state = subjectState(items)
    return { id: subject.id, name: subject.name, state, items }
  })
  const placed = (page.testPlacements ?? []).filter((placement) => !placement.taskId && (placement.originDate ?? day.date) === day.date)
  for (const placement of placed) {
    const assignment = tests[placement.token]
    const score = scores[placement.token]
    const state: LessonWorkItem['state'] = assignment?.status === 'submitted' ? !score ? 'checking' : score.points === score.maxPoints ? 'done' : 'todo' : 'todo'
    const item: LessonWorkItem = { id: `quiz:${placement.token}`, title: assignment?.title ?? 'Самопроверка', state, detail: state === 'done' ? `Тест: ${score?.points} из ${score?.maxPoints} верно` : state === 'checking' ? 'Ответы отправлены, результат уточняется' : assignment?.status === 'submitted' ? 'Есть ошибки; нужно повторить' : 'Нужно пройти тест' }
    const subject = subjects.find((value) => value.id === placement.subjectId)
    if (subject) { subject.items.push(item); subject.state = subjectState(subject.items) }
    else subjects.push({ id: placement.subjectId, name: page.subjects.find((value) => value.id === placement.subjectId)?.name ?? 'Самопроверка', state, items: [item] })
  }
  const items = subjects.flatMap((subject) => subject.items)
  if (!items.length) return { ...blank, state: day.complete && day.homework.length === 0 ? 'none' : 'unknown', reason: day.homework.length ? 'Точный состав ДЗ ещё не опубликован.' : 'ДЗ на этот день ещё уточняется.' }
  const done = items.filter((item) => item.state === 'done').length
  const checking = items.filter((item) => item.state === 'checking').length
  const todo = items.filter((item) => item.state === 'todo').length
  const unclear = items.filter((item) => item.state === 'unclear').length
  return { state: 'ready', day, subjects, done, checking, todo, unclear, total: items.length, weekendCards,
    reason: day.complete ? '' : 'Известные задания показаны; сверка МЭШ ещё не завершена.', error: '' }
}
