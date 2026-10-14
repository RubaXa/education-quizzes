import { useState, type ReactNode } from 'react'
import { ChevronDown, Copy, ExternalLink } from 'lucide-react'
import type { QuizCardAttempt } from '@/lib/quizCardViewModel'
import StatusIcon from './StatusIcon'
import './QuizCard.css'

function scoreNumber(value: number) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value) }
function questionWord(count: number) { const last = count % 10; const lastTwo = count % 100; return lastTwo >= 11 && lastTwo <= 14 ? 'вопросов' : last === 1 ? 'вопрос' : last >= 2 && last <= 4 ? 'вопроса' : 'вопросов' }

/** One quiz projection for a subject task, a standalone test and the test list.
 * Content and attempt history come from Firebase; presentation never depends on subject.
 * @see ../../docs/product/card-generation-policy.md#quiz-adapter
 * @see ../../docs/product/status-presentation.md#components */
export function QuizProgress({ test }: { test: QuizCardAttempt }) {
  const answered = Math.min(test.answered, test.total)
  const remaining = Math.max(0, test.total - answered)
  const scored = test.status === 'submitted' && test.points != null && test.maxPoints != null && test.maxPoints > 0
  const percentage = scored ? Math.round(test.points! / test.maxPoints! * 100) : null
  const label = test.status === 'submitted'
    ? scored ? `Результат · ${scoreNumber(test.points!)} из ${scoreNumber(test.maxPoints!)} баллов · ${percentage}%` : 'Тест отправлен · результат уточняется'
    : answered ? `В процессе · отвечено ${answered} из ${test.total} · осталось ${remaining}`
      : `Тест не начат · ${test.total} ${questionWord(test.total)}`
  return <div className="day-test-progress">
    <span>{label}</span>
    {(scored || test.status !== 'submitted') && <div className="day-test-track" role="progressbar" aria-label={scored ? 'Результат теста в процентах' : 'Ответы на вопросы теста'} aria-valuemin={0} aria-valuemax={scored ? 100 : test.total} aria-valuenow={scored ? percentage! : answered}>
      <span style={{ width: `${scored ? percentage : test.total ? answered / test.total * 100 : 0}%` }} />
    </div>}
  </div>
}

export default function QuizCard({ chain, parent, context = 'Самопроверка', assignment, materials, extraActions, id, onOpen }: {
  chain: QuizCardAttempt[]; parent: boolean; context?: string; assignment?: ReactNode; materials?: ReactNode; extraActions?: ReactNode; id?: string; onOpen?: () => void;
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const latest = chain.at(-1)
  if (!latest) return null
  const earlier = chain.slice(0, -1)
  const graded = earlier.filter((test) => test.status === 'submitted' && test.points != null && test.maxPoints != null)
  const points = graded.reduce((sum, test) => sum + (test.points ?? 0), 0)
  const max = graded.reduce((sum, test) => sum + (test.maxPoints ?? 0), 0)
  const href = parent && latest.status !== 'submitted' && latest.previewToken ? `#/preview/${latest.slug}~${latest.previewToken}` : `#/t/${latest.slug}~${latest.token}`
  const label = parent ? latest.status === 'submitted' ? 'Посмотреть результат' : 'Посмотреть вопросы' : latest.status === 'submitted' ? 'Посмотреть результат' : latest.answered ? 'Продолжить тест' : 'Пройти тест'
  const hasScore = latest.status === 'submitted' && latest.points != null && latest.maxPoints != null && latest.maxPoints > 0
  const scoreLabel = hasScore ? `${Math.round(latest.points! / latest.maxPoints! * 100)}% · ${scoreNumber(latest.points!)} из ${scoreNumber(latest.maxPoints!)}` : latest.status === 'submitted' ? 'Результат уточняется' : latest.answered ? 'В процессе' : 'Не начат'
  const scoreStatus = hasScore ? latest.points === latest.maxPoints ? 'complete' : 'partial'
    : latest.status === 'submitted' ? 'waiting' : latest.answered ? 'started' : 'ready'
  return <section className="day-quiz-lineage" id={id} aria-label={`Самопроверки: ${context}`}>
    <div className="day-quiz-lineage-head"><strong>{context === 'Самопроверка' ? context : `Самопроверка: ${context}`}</strong><span className={`day-quiz-lineage-score ${scoreStatus}`}><StatusIcon status={scoreStatus} size={14} />{scoreLabel}</span></div>
    <div className="day-quiz-lineage-current"><small>{latest.status === 'submitted' ? 'Последний тест' : latest.answered ? 'Сейчас · в процессе' : 'Сейчас · не начат'}</small><h3>{latest.title}</h3>{latest.description && <p>{latest.description}</p>}
      {assignment}
      <QuizProgress test={latest} />
      <div className="day-quiz-lineage-actions"><a className="day-quiz-link" href={href} onClick={onOpen}>{label} <ExternalLink size={15} aria-hidden="true" /></a>{parent && <button type="button" className="day-quiz-copy" aria-label="Скопировать ссылку ребёнку" title="Скопировать ссылку ребёнку" onClick={() => void navigator.clipboard.writeText(new URL(`#/t/${latest.slug}~${latest.token}`, window.location.href).href).then(() => { setCopied(true); setCopyError('') }).catch(() => setCopyError('Не удалось скопировать ссылку.'))}><Copy size={16} aria-hidden="true" /></button>}</div>
      {copied && <small role="status">Ссылка скопирована</small>}{copyError && <small role="alert">{copyError}</small>}
      {materials && <details className="day-quiz-materials"><summary>Условие и страницы учебника <ChevronDown size={15} aria-hidden="true" /></summary><div>{materials}</div></details>}
      {extraActions && <div className="day-quiz-extra-actions">{extraActions}</div>}
    </div>
    {earlier.length > 0 && <details className="day-quiz-history"><summary><span><strong>Предыдущие тесты</strong><small>{earlier.length} {earlier.length === 1 ? 'тест' : earlier.length < 5 ? 'теста' : 'тестов'}{max ? ` · ${scoreNumber(points)} из ${scoreNumber(max)} баллов` : ''}</small></span>{max > 0 && <span className={`day-quiz-history-score ${points === max ? 'complete' : ''}`} aria-label={`${Math.round(points / max * 100)} процентов набранных баллов`}><i style={{ width: `${Math.round(points / max * 100)}%` }} />{Math.round(points / max * 100)}%</span>}<ChevronDown size={18} aria-hidden="true" /></summary><div className="day-quiz-history-body">{earlier.map((test) => <div className="day-quiz-history-row" key={test.token}><strong>{test.title}</strong><span>{test.status === 'submitted' ? test.points == null ? 'Отправлен · балл уточняется' : `${scoreNumber(test.points)} из ${scoreNumber(test.maxPoints!)} баллов` : 'Не завершён'}</span><a href={parent && test.status !== 'submitted' && test.previewToken ? `#/preview/${test.slug}~${test.previewToken}` : `#/t/${test.slug}~${test.token}`}>{test.status === 'submitted' ? 'Посмотреть результат' : 'Посмотреть вопросы'} <ExternalLink size={13} aria-hidden="true" /></a></div>)}</div></details>}
  </section>
}
