import { ExternalLink } from 'lucide-react'
import type { QuizCardAttempt } from '@/lib/quizCardViewModel'
import QuizResultCard from './QuizResultCard'

/** Same graded projection and safe question feedback as the standalone result. No new listeners.
 * @see ../../docs/product/quiz-chain-proposal.md */
export default function QuizAttemptReview({ test, parent, linksEnabled = true }: { test: QuizCardAttempt; parent: boolean; linksEnabled?: boolean }) {
  const errors = test.results?.map((result,index) => ({result,index})).filter(({result}) => !result.skipped && (result.points === null || result.points < result.question.points))
  const checked = test.results?.filter(result => !result.skipped && result.points !== null).length ?? 0
  return <div className="day-quiz-inline-review" role="region" aria-label={`Разбор теста «${test.title}»`}>
    <strong>{test.title}</strong>
    {!test.results ? <p>Подробности результата пока недоступны.</p> : !errors?.length ? <p>{checked ? 'Все проверенные ответы верны.' : 'Нет проверенных ответов для оценки.'}</p> : errors.map(({result,index}) => <QuizResultCard key={result.question.id} result={result} index={index} />)}
    {linksEnabled ? <a className="day-quiz-full-result" href={parent && test.status !== 'submitted' && test.previewToken ? `#/preview/${test.slug}~${test.previewToken}` : `#/t/${test.slug}~${test.token}`}>Полный результат <ExternalLink size={13} aria-hidden="true" /></a> : <small>Полный результат · демонстрационный пример</small>}
  </div>
}
