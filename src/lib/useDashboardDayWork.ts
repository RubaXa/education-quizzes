import { useEffect, useMemo, useState } from 'react'
import { watchDayPage, watchDayReviews, watchDayUploads, watchEvidenceDayPages, withVerifiedPlatformResult } from './dayStore'
import type { DayPageData, DayUpload, DayWorkReview } from './dayStore'
import { useParentCompletions } from './useParentCompletions'
import { useDayQuizOutcomes } from './useDayQuizOutcomes'
import { reportUiError } from './uiErrors'

/** Reuse one live Firestore projection for the selected lesson and the next homework day.
 * @see ../../docs/modules/school-diary/dashboard.md#homework-progress
 * @see ../../docs/shared/design/README.md#cards-and-status
 */
export function useDashboardDayWork(dayToken: string | null | undefined, date: string, parent: boolean, onError: (message: string) => void) {
  const [pageState, setPageState] = useState<{ token: string; data: DayPageData }>()
  const linkedPage = pageState && pageState.token === dayToken ? pageState.data : undefined
  const page = linkedPage?.targetDate === date ? linkedPage : undefined
  useEffect(() => {
    if (!dayToken) return
    return watchDayPage(dayToken, (data) => setPageState({ token: dayToken, data }),
      (cause) => onError(reportUiError(cause, 'Учебный день')))
  }, [dayToken, onError])

  const studentToken = page ? (page.studentToken ?? dayToken) : undefined
  const evidenceTokens = useMemo(() => [...new Set([studentToken, ...(page?.evidenceDayTokens ?? [])]
    .filter((value): value is string => Boolean(value)))], [studentToken, page])
  const evidenceKey = evidenceTokens.join('|')
  const parentDecisions = useParentCompletions(evidenceKey, Boolean(page))
  const [uploadState, setUploadState] = useState<{ key: string; value: DayUpload[] }>({ key: '', value: [] })
  const [reviewState, setReviewState] = useState<{ key: string; value: DayWorkReview[] }>({ key: '', value: [] })
  const [evidenceState, setEvidenceState] = useState<{ key: string; value: DayPageData[] }>({ key: '', value: [] })
  const uploads = uploadState.key === evidenceKey ? uploadState.value : []
  const reviews = reviewState.key === evidenceKey ? reviewState.value : []
  const evidencePages = evidenceState.key === evidenceKey ? evidenceState.value : []
  useEffect(() => {
    if (!evidenceKey) return
    return watchDayUploads(evidenceKey.split('|'), (value) => setUploadState({ key: evidenceKey, value }),
      (cause) => onError(reportUiError(cause, 'Учебный день')))
  }, [evidenceKey, onError])
  useEffect(() => {
    if (!evidenceKey) return
    return watchDayReviews(evidenceKey.split('|'), (value) => setReviewState({ key: evidenceKey, value }),
      (cause) => onError(reportUiError(cause, 'Учебный день')), parent)
  }, [evidenceKey, onError, parent])
  useEffect(() => {
    if (!evidenceKey) return
    return watchEvidenceDayPages(evidenceKey.split('|'), (value) => setEvidenceState({ key: evidenceKey, value }),
      (cause) => onError(reportUiError(cause, 'Учебный день')))
  }, [evidenceKey, onError])

  const { tests, scores, ready: quizReady } = useDayQuizOutcomes(page, date, onError)

  const subjects = page?.subjects.map((subject) => ({ ...subject, tasks: subject.tasks
    .filter((task) => (task.originDate ?? date) === date)
    .map((task) => withVerifiedPlatformResult(task, date, evidencePages)) })).filter((subject) => subject.tasks.length) ?? []
  // A missing stream is not evidence of zero completed work. The dashboard
  // keeps its previous complete local view until every status source responds.
  const ready = Boolean(page && evidenceKey && uploadState.key === evidenceKey
    && reviewState.key === evidenceKey && evidenceState.key === evidenceKey
    && parentDecisions.ready && quizReady)
  return { page, linkedPage, subjects, uploads, reviews, tests, scores, parentDecisions, ready }
}
