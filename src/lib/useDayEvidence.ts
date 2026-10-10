import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { watchDayReviews, watchDayUploads } from './dayStore'
import type { DayPageData, DayUpload, DayWorkReview } from './dayStore'

type Snapshot<T> = { key: string; items: T[] }

/** One evidence stream for every view of the same child and day. @see ../../docs/architecture/backend-driven-ui.md#legacy-evidence */
export function useDayEvidence(page: DayPageData | undefined, token: string, setError: Dispatch<SetStateAction<string>>) {
  const studentToken = page?.studentToken ?? token
  const evidenceKey = [...new Set([studentToken, ...(page?.evidenceDayTokens ?? [])])].join('|')
  const [uploadSnapshot, setUploadSnapshot] = useState<Snapshot<DayUpload>>({ key: '', items: [] })
  const [reviewSnapshot, setReviewSnapshot] = useState<Snapshot<DayWorkReview>>({ key: '', items: [] })
  const hasPage = Boolean(page)

  useEffect(() => {
    if (!hasPage) return
    return watchDayUploads(evidenceKey.split('|'), (items) => setUploadSnapshot({ key: evidenceKey, items }), (cause) => setError(cause.message))
  }, [evidenceKey, hasPage, setError])
  useEffect(() => {
    if (!hasPage) return
    return watchDayReviews(evidenceKey.split('|'), (items) => setReviewSnapshot({ key: evidenceKey, items }), (cause) => setError(cause.message))
  }, [evidenceKey, hasPage, setError])

  return {
    studentToken,
    evidenceKey,
    uploads: uploadSnapshot.key === evidenceKey ? uploadSnapshot.items : [],
    reviews: reviewSnapshot.key === evidenceKey ? reviewSnapshot.items : [],
    ready: hasPage && uploadSnapshot.key === evidenceKey && reviewSnapshot.key === evidenceKey,
  }
}
