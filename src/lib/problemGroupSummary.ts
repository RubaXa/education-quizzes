import { uploadMatchesTask } from './dayStore'
import type { DayProblem, DayUpload, DayWorkReview } from './dayStore'

export type ProblemGroupSummary = {
  complete: boolean
  verifiedCount: number
  total: number
  photoCount: number
  activeCount: number
  numbers: string
  conclusion: string
  tone: 'success' | 'partial' | 'error' | 'working' | 'neutral'
}

/** @see ../../docs/product/day-page.md#completed-problem-group */
export function summarizeProblemGroup(problems: DayProblem[], uploads: DayUpload[], reviews: DayWorkReview[], localPendingCount: number, ready: boolean): ProblemGroupSummary {
  const linked = uploads.filter((upload) => problems.some((problem) => uploadMatchesTask(upload, problem.id)))
  const reviewed = linked.filter((upload) => upload.status === 'reviewed')
  const received = linked.filter((upload) => ['uploaded', 'pending', 'reviewed'].includes(upload.status))
  const activeCount = linked.filter((upload) => upload.status !== 'reviewed').length + localPendingCount
  const reviewFor = (problem: DayProblem) => reviews.find((review) => review.taskId === problem.id)
  const verifiedCount = problems.filter((problem) => {
    const review = reviewFor(problem)
    if (review?.status !== 'verified') return false
    const problemPhotos = reviewed.filter((upload) => uploadMatchesTask(upload, problem.id))
    return problemPhotos.length > 0 && problemPhotos.some((upload) => review.uploadIds?.includes(upload.id.split(':').at(-1) ?? ''))
  }).length
  const complete = ready && problems.length > 0 && verifiedCount === problems.length && activeCount === 0
  const reasoningConfirmed = complete && problems.every((problem) => {
    const reasoning = reviewFor(problem)?.mathReasoning
    return reasoning?.answer === 'correct' && reasoning.argument === 'sufficient'
  })
  const needsFix = problems.filter((problem) => reviewFor(problem)?.status === 'needs-fix').length
  const partial = problems.filter((problem) => reviewFor(problem)?.status === 'partial').length
  const conclusion = !ready ? 'Загружаем результаты проверки…'
    : complete ? reasoningConfirmed ? 'Хорошо: ответы и ход решения подтверждены во всех номерах.' : 'Все номера проверены по загруженным работам.'
      : activeCount ? 'Есть новые фото: дождитесь проверки, чтобы увидеть итог.'
        : needsFix || partial ? 'Есть номера для исправления или дополнения.'
          : verifiedCount ? 'Часть номеров подтверждена; остальные ещё открыты.'
            : 'Откройте номера, чтобы посмотреть условия и работы.'
  const tone = complete ? 'success' : activeCount ? 'working' : needsFix && !verifiedCount ? 'error' : needsFix || partial || verifiedCount ? 'partial' : 'neutral'
  return { complete, verifiedCount, total: problems.length, photoCount: received.length, activeCount, numbers: problems.map((problem) => problem.number).join(', '), conclusion, tone }
}
