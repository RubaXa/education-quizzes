import { useEffect, useMemo, useState } from 'react'
import type { DayPageData } from './dayStore'
import type { Assignment, QuestionResult } from './quiz'
import type { QuizScore } from './homeworkStatus'
import { watchDashboard } from './store'
import { watchQuizOutcome } from './watchQuizOutcome'
import { reportUiError } from './uiErrors'

/** The board identifies every continuation of a placed test. Both parent summaries
 * and the day dashboard use the same live chain as the detailed task card.
 * @see ../../docs/modules/school-diary/dashboard.md#homework-progress */
export function useDayQuizOutcomes(page: DayPageData | null | undefined, date: string, onError: (message: string) => void) {
  const boardToken = page?.boardToken
  const [boardState, setBoardState] = useState<{ token: string; entries: Awaited<ReturnType<typeof import('./store').loadDashboard>> }>()
  useEffect(() => {
    if (!boardToken) return
    return watchDashboard(boardToken, (entries) => setBoardState({ token: boardToken, entries }),
      (cause) => onError(reportUiError(cause, 'Список тестов')))
  }, [boardToken, onError])

  const roots = useMemo(() => [...new Set([
    ...(page?.subjects.flatMap((subject) => subject.tasks
      .filter((task) => (task.originDate ?? date) === date).map((task) => task.testToken)) ?? []),
    ...(page?.testPlacements?.filter((placement) => (placement.originDate ?? date) === date).map((placement) => placement.token) ?? []),
  ].filter((token): token is string => Boolean(token)))], [page, date])
  const boardReady = !boardToken || boardState?.token === boardToken
  const tokens = useMemo(() => {
    const entries = boardState?.token === boardToken ? boardState?.entries ?? [] : []
    const selected = new Set(roots)
    const ids = new Set(entries.filter((entry) => selected.has(entry.token)).map((entry) => entry.testId))
    let added = true
    while (added) {
      added = false
      for (const entry of entries) {
        if (!entry.linkedToTestId || !ids.has(entry.linkedToTestId) || selected.has(entry.token)) continue
        selected.add(entry.token)
        ids.add(entry.testId)
        added = true
      }
    }
    return [...selected]
  }, [boardState, boardToken, roots])
  const tokenKey = tokens.join('|')
  const [outcomes, setOutcomes] = useState<{ key: string; items: Record<string, { assignment: Assignment; score?: QuizScore; results?: QuestionResult[]; scoreReady: boolean }> }>()
  useEffect(() => {
    if (!tokenKey) return
    const items: Record<string, { assignment: Assignment; score?: QuizScore; results?: QuestionResult[]; scoreReady: boolean }> = {}
    // The board can publish a new object with exactly the same tokens. Only a
    // changed token set should reopen Firestore listeners.
    const stops = tokenKey.split('|').map((token) => watchQuizOutcome(token, (outcome) => {
      items[token] = outcome
      setOutcomes({ key: tokenKey, items: { ...items } })
    }, (cause) => onError(reportUiError(cause, 'Результаты тестов'))))
    return () => stops.forEach((stop) => stop())
  }, [tokenKey, onError])
  const items = outcomes?.key === tokenKey ? outcomes.items : {}
  return {
    boardEntries: boardState?.token === boardToken ? boardState?.entries ?? [] : [],
    tests: Object.fromEntries(Object.entries(items).map(([token, outcome]) => [token, outcome.assignment])) as Record<string, Assignment>,
    scores: Object.fromEntries(Object.entries(items).filter(([, outcome]) => outcome.score).map(([token, outcome]) => [token, outcome.score!])) as Record<string, QuizScore>,
    results: Object.fromEntries(Object.entries(items).filter(([, outcome]) => outcome.results).map(([token, outcome]) => [token, outcome.results!])),
    ready: boardReady && tokens.every((token) => items[token]?.scoreReady),
  }
}
