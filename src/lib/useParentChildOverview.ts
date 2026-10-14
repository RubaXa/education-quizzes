import { useEffect, useMemo, useState } from 'react'
import { watchDayDashboard } from './dayDashboardStore'
import type { DayDashboardData, IndexedDay } from './dayDashboardStore'
import { watchDayPage, watchDayReviews, watchDayUploads, watchEvidenceDayPages, withVerifiedPlatformResult } from './dayStore'
import type { DayPageData, DayUpload, DayWorkReview } from './dayStore'
import { useParentCompletions } from './useParentCompletions'
import { lessonWorkItems, quizRequirement } from './homeworkStatus'
import { quizTaskForPlacement, withQuizPlacements } from './quizCardViewModel'
import type { LessonWorkItem } from './homeworkStatus'
import { useDayQuizOutcomes } from './useDayQuizOutcomes'
import { reportUiError } from './uiErrors'
import { parentFocusDay } from './parentFocusDay'

export type ParentSubjectOverview = {
  id: string
  name: string
  state: 'done' | 'todo' | 'checking' | 'unclear' | 'unknown'
  items: LessonWorkItem[]
  rawHomework?: string
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
  fromCache?: boolean
  cachedAt?: number
}

function overviewCacheKey(personId: string, dashboardToken: string) {
  return `education-parent-overview-v1:${personId}:${dashboardToken}`
}
function readOverview(personId: string, dashboardToken: string): ParentChildOverview | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(overviewCacheKey(personId, dashboardToken)) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const overview = value as ParentChildOverview
    return (overview.state === 'ready' || overview.state === 'none') &&
      (overview.day === null || Boolean(overview.day && /^\d{4}-\d{2}-\d{2}$/.test(overview.day.date))) &&
      Array.isArray(overview.subjects) && overview.subjects.every((subject) =>
        subject && typeof subject.id === 'string' && typeof subject.name === 'string' &&
        ['done', 'todo', 'checking', 'unclear'].includes(subject.state) && Array.isArray(subject.items) &&
        subject.items.every((item) => item && typeof item.id === 'string' && typeof item.title === 'string' &&
          typeof item.detail === 'string' && ['done', 'todo', 'checking', 'unclear'].includes(item.state))) &&
      ['done', 'checking', 'todo', 'unclear', 'total', 'weekendCards'].every((field) => Number.isSafeInteger(overview[field as keyof ParentChildOverview])) &&
      typeof overview.cachedAt === 'number' && overview.cachedAt <= Date.now() + 60_000 ? overview : null
  } catch { return null }
}

function moscowToday(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
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
function useLiveParentChildOverview(dashboardToken: string): ParentChildOverview {
  const [index, setIndex] = useState<DayDashboardData | null>(null)
  const [indexReady, setIndexReady] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return watchDayDashboard(dashboardToken, (data) => {
      if (data.kind !== 'parent') { setError('Для ребёнка не опубликован родительский календарь.'); setIndexReady(true); return }
      setIndex(data)
      setIndexReady(true)
      setError('')
    }, (cause) => { setError(reportUiError(cause, 'Обзор ребёнка')); setIndexReady(true) })
  }, [dashboardToken])

  const today = moscowToday(new Date(now))
  const day = parentFocusDay(index, new Date(now))
  const weekendCards = index?.weekendWork?.filter((slot) => slot.dates.includes(today)).length ?? 0
  const dayToken = day?.homeworkDayToken ?? null
  const [pageSnapshot, setPageSnapshot] = useState<{ token: string; page: DayPageData } | null>(null)
  useEffect(() => {
    if (!dayToken) return
    return watchDayPage(dayToken, (page) => setPageSnapshot({ token: dayToken, page }), (cause) => setError(reportUiError(cause, 'Обзор ребёнка')))
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
    return watchDayUploads(evidenceKey.split('|'), (items) => setUploadSnapshot({ key: evidenceKey, items }), (cause) => setError(reportUiError(cause, 'Обзор ребёнка')))
  }, [evidenceKey])
  useEffect(() => {
    if (!evidenceKey) return
    return watchDayReviews(evidenceKey.split('|'), (items) => setReviewSnapshot({ key: evidenceKey, items }), (cause) => setError(reportUiError(cause, 'Обзор ребёнка')), true)
  }, [evidenceKey])
  useEffect(() => {
    if (!evidenceKey) return
    return watchEvidenceDayPages(evidenceKey.split('|'), (pages) => setPageEvidenceSnapshot({ key: evidenceKey, pages }), (cause) => setError(reportUiError(cause, 'Обзор ребёнка')))
  }, [evidenceKey])

  const { tests, scores, ready: testsReady } = useDayQuizOutcomes(page, day?.date ?? '', setError)
  const loadKey = `${dashboardToken}|${day?.date ?? ''}|${dayToken ?? ''}|${evidenceKey}|${testsReady}`
  const [expiredKey, setExpiredKey] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setExpiredKey(loadKey), 15_000)
    return () => window.clearTimeout(timer)
  }, [loadKey])
  const loadingExpired = expiredKey === loadKey
  const blank: ParentChildOverview = { state: 'loading', day, subjects: [], done: 0, checking: 0, todo: 0, unclear: 0, total: 0, weekendCards, reason: '', error }
  if (error) return { ...blank, state: 'unknown', reason: 'Сведения не удалось сверить. Откройте календарь для подробностей.' }
  if (!indexReady) return loadingExpired ? { ...blank, state: 'unknown', reason: 'Календарь пока не загрузился. Проверьте связь и откройте календарь ребёнка.' } : blank
  if (!day) return { ...blank, state: 'unknown', reason: 'Расписание следующего учебного дня ещё не загружено.' }
  if (!dayToken || !page) {
    if (day.complete && day.homework.length === 0) return { ...blank, state: 'none', reason: 'На последней сверке МЭШ домашнее задание к этому дню не задано.' }
    return { ...blank, state: 'unknown', reason: day.homework.length ? 'ДЗ найдено в МЭШ; подробный план ещё готовится.' : 'ДЗ на этот день ещё уточняется.' }
  }
  if (decisions.error) return { ...blank, state: 'unknown', reason: 'Не удалось получить решения взрослого. Откройте календарь для подробностей.' }
  if (!evidenceKey || uploadSnapshot?.key !== evidenceKey || reviewSnapshot?.key !== evidenceKey || pageEvidenceSnapshot?.key !== evidenceKey || !decisions.ready) {
    return { ...blank, state: loadingExpired ? 'unknown' : 'loading', reason: loadingExpired ? 'Не удалось получить все результаты. Откройте календарь ребёнка для подробностей.' : 'Загружаем работы и результаты.' }
  }
  if (!testsReady) {
    return { ...blank, state: loadingExpired ? 'unknown' : 'loading', reason: loadingExpired ? 'Не удалось получить все результаты тестов. Откройте календарь ребёнка.' : 'Загружаем результаты тестов.' }
  }
  const uploads = uploadSnapshot.items
  const reviews = reviewSnapshot.items
  const evidencePages = pageEvidenceSnapshot.pages
  const quizStates = Object.fromEntries(Object.entries(tests).map(([token, assignment]) => [token, {
    status: assignment.status, testId: assignment.testId, linkedToTestId: assignment.linkedToTestId,
    title: assignment.title, followupRequested: Boolean(assignment.followupRequestedAt),
  }]))
  // A MESH pointer to an earlier day has no new work item and must not become a completed subject.
  // @see ../../docs/product/dashboard.md#reference-only-homework
  const subjects: ParentSubjectOverview[] = page.subjects.filter((subject) => subject.tasks.some((task) => (task.originDate ?? day.date) === day.date)).map((subject) => {
    const rawTasks = subject.tasks.filter((task) => (task.originDate ?? day.date) === day.date).map((task) => withVerifiedPlatformResult(task, day.date, evidencePages))
    const placements = (page.testPlacements ?? []).filter((placement) => placement.subjectId === subject.id && (placement.originDate ?? day.date) === day.date)
    const tasks = withQuizPlacements(rawTasks, placements)
    const items = lessonWorkItems(tasks, uploads, reviews, decisions.events, quizStates, scores)
    const state = subjectState(items)
    return { id: subject.id, name: subject.name, state, items }
  }).filter((subject) => subject.items.length > 0)
  const placed = (page.testPlacements ?? []).filter((placement) => !placement.taskId && (placement.originDate ?? day.date) === day.date && !tests[placement.token]?.linkedToTestId
    && !page.subjects.some((subject) => subject.id === placement.subjectId && quizTaskForPlacement(subject.tasks, (page.testPlacements ?? []).filter((item) => item.subjectId === subject.id && (item.originDate ?? day.date) === day.date), placement)))
  for (const placement of placed) {
    const assignment = tests[placement.token]
    const item: LessonWorkItem = { id: `quiz:${placement.token}`, title: assignment?.title ?? 'Самопроверка', ...quizRequirement(placement.token, quizStates, scores) }
    const subject = subjects.find((value) => value.id === placement.subjectId)
    const lineageItems = [item]
    if (subject) { subject.items.push(...lineageItems); subject.state = subjectState(subject.items) }
    else subjects.push({ id: placement.subjectId, name: page.subjects.find((value) => value.id === placement.subjectId)?.name ?? 'Самопроверка', state: subjectState(lineageItems), items: lineageItems })
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

/** Show the last complete parent projection on the first frame, then replace it
 * atomically after all live evidence streams have produced a consistent view.
 * @see ../../docs/architecture/local-first-release-plan-2026-10-12.md#personal-startup
 */
export function useParentChildOverview(dashboardToken: string, personId: string): ParentChildOverview {
  const cached = readOverview(personId, dashboardToken)
  const live = useLiveParentChildOverview(dashboardToken)
  const liveSerialized = live.state === 'ready' || live.state === 'none' ? JSON.stringify(live) : ''
  useEffect(() => {
    if (!liveSerialized) return
    const stable = { ...JSON.parse(liveSerialized) as ParentChildOverview, fromCache: false, cachedAt: Date.now() }
    try { localStorage.setItem(overviewCacheKey(personId, dashboardToken), JSON.stringify(stable)) }
    catch { /* The current screen remains live without durable storage. */ }
  }, [personId, dashboardToken, liveSerialized])
  if ((live.state === 'loading' || live.state === 'unknown') && cached) {
    if (!live.day) return { ...cached, fromCache: true }
    const sameDay = cached.day?.date === live.day.date
    const previousHomework = new Map((sameDay ? cached.day?.homework ?? [] : [])
      .map((item) => [item.subject.toLocaleLowerCase('ru-RU'), item.text]))
    const changed = live.day.homework.filter((item) => previousHomework.get(item.subject.toLocaleLowerCase('ru-RU')) !== item.text)
    if (!changed.length && sameDay) return { ...cached, day: live.day, fromCache: true }
    const changedNames = new Set(changed.map((item) => item.subject.toLocaleLowerCase('ru-RU')))
    const retained = sameDay ? cached.subjects.filter((subject) => !changedNames.has(subject.name.toLocaleLowerCase('ru-RU'))) : []
    const pending = changed.map((item, index): ParentSubjectOverview => ({
      id: `mesh-pending-${index}`, name: item.subject, state: 'unknown', items: [], rawHomework: item.text,
    }))
    return { ...cached, state: 'unknown', day: live.day, subjects: [...retained, ...pending],
      reason: 'Новые записи МЭШ видны; результаты работ ещё сверяются.', fromCache: true }
  }
  return live
}
