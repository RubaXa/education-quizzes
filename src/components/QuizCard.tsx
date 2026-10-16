import { Fragment, useId, useState, type ReactNode } from 'react'
import { ChevronDown, Clock3, Copy, ExternalLink, RotateCcw } from 'lucide-react'
import { quizAnswerCounts, quizHistoryNewestFirst, quizTimestamp, type QuizCardAttempt } from '@/lib/quizCardViewModel'
import { resultPresentation, type ResultInput } from '@/lib/resultPresentation'
import { requestQuizFollowup, setQuizRequired } from '@/lib/store'
import RequirementSwitch from './RequirementSwitch'
import QuizAttemptReview from './QuizAttemptReview'
import { ResultBadge, ResultMeter, ResultPoints } from './ui/result'
import './QuizCard.css'

function errorWord(count: number) { const last = count % 10; const lastTwo = count % 100; return lastTwo >= 11 && lastTwo <= 14 ? 'ошибок' : last === 1 ? 'ошибка' : last >= 2 && last <= 4 ? 'ошибки' : 'ошибок' }
function questionWord(count: number) { const last = count % 10; const lastTwo = count % 100; return lastTwo >= 11 && lastTwo <= 14 ? 'вопросов' : last === 1 ? 'вопрос' : last >= 2 && last <= 4 ? 'вопроса' : 'вопросов' }
function inputFor(test: QuizCardAttempt): ResultInput {
  return test.status === 'submitted' ? test.points == null || test.maxPoints == null ? {kind:'waiting'} : {kind:'score',points:test.points,maxPoints:test.maxPoints}
    : {kind:'answers',answered:Math.min(test.answered,test.total),total:test.total}
}
const quizTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
})
/** @see ../../docs/product/quizzes.md#attempt-time */
function QuizTimeDetails({ test, id }: { test: QuizCardAttempt; id: string }) {
  const row = (label: string, value: unknown, missing: string) => {
    const time = quizTimestamp(value)
    return <div key={label}><dt>{label}</dt><dd>{time ? <time dateTime={new Date(time).toISOString()}>{quizTimeFormatter.format(time)}</time> : missing}</dd></div>
  }
  return <div className="day-quiz-time-details" id={id} role="region" aria-label={`Время теста «${test.title}»`}><dl>
    {row('Создан',test.createdAt,'Время неизвестно')}
    {row('Начат',test.startedAt,test.status === 'open' && !test.answered ? 'Не начат' : 'Время неизвестно')}
    {row('Последнее изменение',test.updatedAt,test.status === 'open' && !test.answered ? 'Не изменялся' : 'Время неизвестно')}
    {row('Завершён',test.submittedAt,test.status === 'open' ? 'Не завершён' : 'Время неизвестно')}
  </dl></div>
}

/** Same indicators in the task card, board and UI Kit.
 * @see ../../docs/product/result-presentation-proposal.md */
export function QuizProgress({ test }: { test: QuizCardAttempt }) {
  const input = inputFor(test)
  const view = resultPresentation(input)
  const counts = quizAnswerCounts(test)
  return <div className="day-test-progress">
    {test.status === 'submitted' && view.points != null ? <>
      <div className="day-quiz-stats" aria-label="Результат по вопросам и баллам">
        <span><b>{test.total}</b><small>вопросов</small></span>
        <span><b className={counts?.correct ? "day-quiz-correct" : "day-quiz-denominator"}>{counts?.correct ?? '—'}</b><small>верно</small></span>
        <span><b className={counts && counts.incorrect + counts.partial + counts.unanswered > 0 ? 'day-quiz-wrong' : ''}>{counts ? counts.incorrect + counts.partial + counts.unanswered : '—'}</b><small>с ошибкой</small></span>
        <span><ResultPoints points={test.points} maxPoints={test.maxPoints} /><small>баллов</small></span>
      </div>
      {counts && (counts.partial > 0 || counts.excluded > 0) && <p className="day-quiz-count-note">{counts.partial > 0 && `Частично верно: ${counts.partial}. `}{counts.excluded > 0 && `Не оценивалось: ${counts.excluded}.`}</p>}
    </> : <p>{test.status === 'submitted' ? 'Тест отправлен · результат уточняется' : test.answered ? `В процессе · отвечено ${test.answered} из ${test.total} · осталось ${Math.max(0,test.total-test.answered)}` : `${test.total} ${questionWord(test.total)}`}</p>}
    <ResultMeter input={input} label={test.status === 'submitted' ? 'Результат теста в процентах' : 'Ответы на вопросы теста'} />
  </div>
}

/** One shared card: day, board, history. The chain stays causal; only history display is sorted.
 * @see ../../docs/product/quiz-chain-proposal.md
 * @see ../../docs/product/result-presentation-proposal.md
 * @see ../../docs/product/quizzes.md#optional-quiz */
export default function QuizCard({ chain, parent, context = 'Самопроверка', assignment, materials, extraActions, id, onOpen, allowFollowupRequest = true, linksEnabled = true }: {
  chain: QuizCardAttempt[]; parent: boolean; context?: string; assignment?: ReactNode; materials?: ReactNode; extraActions?: ReactNode; id?: string; onOpen?: () => void; allowFollowupRequest?: boolean; linksEnabled?: boolean;
}) {
  const [copiedToken,setCopiedToken] = useState('')
  const [copyError,setCopyError] = useState('')
  const [requesting,setRequesting] = useState(false)
  const [requestError,setRequestError] = useState('')
  const [requestedToken,setRequestedToken] = useState('')
  const [savingRequirement,setSavingRequirement] = useState(false)
  const [requirementError,setRequirementError] = useState('')
  const [openTimeToken,setOpenTimeToken] = useState<string | null>(null)
  const [openReviewToken,setOpenReviewToken] = useState<string | null>(null)
  const timeBaseId = useId()
  const latest = chain.at(-1)
  if (!latest) return null
  const root = chain[0]
  const required = !root.familyOptional
  const earlier = quizHistoryNewestFirst(chain.slice(0,-1))
  const graded = chain.filter(test => test.status === 'submitted' && resultPresentation(inputFor(test)).points != null)
  const points = graded.reduce((sum,test) => sum + test.points!,0)
  const max = graded.reduce((sum,test) => sum + test.maxPoints!,0)
  const href = parent && latest.status !== 'submitted' && latest.previewToken ? `#/preview/${latest.slug}~${latest.previewToken}` : `#/t/${latest.slug}~${latest.token}`
  const label = parent ? 'Посмотреть вопросы' : latest.answered ? 'Продолжить тест' : 'Пройти тест'
  const view = resultPresentation(inputFor(latest))
  const hasScore = view.points != null
  const followupRequested = Boolean(latest.followupRequested || requestedToken === latest.token)
  const timePanelId = (test: QuizCardAttempt) => `${timeBaseId}-${test.token}-time`
  const reviewPanelId = (test: QuizCardAttempt) => `${timeBaseId}-${test.token}-review`
  const timeButton = (test: QuizCardAttempt) => <button type="button" className="day-quiz-time-trigger" aria-label={`${openTimeToken === test.token ? 'Скрыть' : 'Показать'} время теста «${test.title}»`} aria-controls={openTimeToken === test.token ? timePanelId(test) : undefined} aria-expanded={openTimeToken === test.token} onClick={() => setOpenTimeToken(current => current === test.token ? null : test.token)}><Clock3 size={17} aria-hidden="true" /></button>
  const reviewButton = (test: QuizCardAttempt) => { setOpenReviewToken(current => current === test.token ? null : test.token); onOpen?.() }
  return <section className="day-quiz-lineage" id={id} aria-label={`Самопроверки: ${context}`}>
    <div className="day-quiz-lineage-head"><strong>{context === 'Самопроверка' ? context : `Самопроверка: ${context}`}</strong><div className="day-quiz-lineage-meta"><span className="day-quiz-score-time"><ResultBadge input={inputFor(latest)} showPoints className={`day-quiz-lineage-score ${view.status}`} />{timeButton(latest)}</span>{latest.status === 'open' && (parent ? <span className="day-quiz-requirement"><RequirementSwitch checked={required} disabled={savingRequirement} label={`Учитывать тест «${latest.title}» в семейном плане`} onChange={next => { setSavingRequirement(true); setRequirementError(''); void setQuizRequired(root.rootToken ?? root.token,latest.token,next).catch(cause => setRequirementError(cause instanceof Error ? cause.message : 'Не удалось сохранить выбор.')).finally(() => setSavingRequirement(false)) }} /></span> : !required && <span className="day-quiz-optional-label">По желанию</span>)}</div></div>
    {openTimeToken === latest.token && <QuizTimeDetails test={latest} id={timePanelId(latest)} />}
    <div className="day-quiz-lineage-current">{latest.status === 'submitted' && earlier.length > 0 && <small>Последний тест</small>}<h3>{latest.title}</h3>{latest.description && <p>{latest.description}</p>}
      {assignment}
      <QuizProgress test={latest} />
      <div className="day-quiz-lineage-actions">{parent && <button type="button" className="day-quiz-copy" disabled={requesting || followupRequested || !allowFollowupRequest || !hasScore || latest.status !== 'submitted'} aria-label={followupRequested ? 'Новый тест запрошен' : 'Создать новый тест с учётом всех попыток'} title={followupRequested ? 'Запрос сохранён · ждём Education Sync' : !allowFollowupRequest ? 'У этой попытки уже есть продолжение' : !hasScore || latest.status !== 'submitted' ? 'Сначала нужно завершить и проверить текущий тест' : 'Создать новый тест с учётом всех попыток'} onClick={() => { setRequesting(true); setRequestError(''); void requestQuizFollowup(latest.token,latest.testId).then(() => setRequestedToken(latest.token)).catch(cause => setRequestError(cause instanceof Error ? cause.message : 'Не удалось отправить запрос.')).finally(() => setRequesting(false)) }}>{followupRequested || requesting ? <Clock3 size={17} aria-hidden="true" /> : <RotateCcw size={17} aria-hidden="true" />}</button>}
        {latest.status === 'submitted' ? <button type="button" className="day-quiz-link" aria-expanded={openReviewToken === latest.token} aria-controls={openReviewToken === latest.token ? reviewPanelId(latest) : undefined} onClick={() => reviewButton(latest)}>Разбор <ChevronDown size={15} aria-hidden="true" /></button> : <a className="day-quiz-link" href={href} onClick={onOpen}>{label} <ExternalLink size={15} aria-hidden="true" /></a>}
        {parent && <button type="button" className="day-quiz-copy" aria-label="Скопировать ссылку ребёнку" title="Скопировать ссылку ребёнку" onClick={() => void navigator.clipboard.writeText(new URL(`#/t/${latest.slug}~${latest.token}`,window.location.href).href).then(() => { setCopiedToken(latest.token); setCopyError('') }).catch(() => setCopyError('Не удалось скопировать ссылку.'))}><Copy size={16} aria-hidden="true" /></button>}
      </div>
      {openReviewToken === latest.token && <div id={reviewPanelId(latest)}><QuizAttemptReview test={latest} parent={parent} linksEnabled={linksEnabled} /></div>}
      {followupRequested && <small className="day-quiz-request-state" role="status">Новый тест запрошен · ждём новый тест</small>}{requestError && <small role="alert">{requestError}</small>}{savingRequirement && <small role="status">Сохраняем выбор…</small>}{requirementError && <small role="alert">{requirementError}</small>}
      {copiedToken === latest.token && <small role="status">Ссылка скопирована</small>}{copyError && <small role="alert">{copyError}</small>}
      {materials && <details className="day-quiz-materials"><summary>Условие и страницы учебника <ChevronDown size={15} aria-hidden="true" /></summary><div>{materials}</div></details>}
      {extraActions && <div className="day-quiz-extra-actions">{extraActions}</div>}
    </div>
    {earlier.length > 0 && <>
      <div className="day-quiz-chain-summary"><strong>Вся цепочка · {chain.length} {chain.length < 5 ? 'теста' : 'тестов'}</strong><ResultBadge input={max ? {kind:'score',points,maxPoints:max} : {kind:'unknown'}} /><small><ResultPoints points={max ? points : undefined} maxPoints={max} /> баллов · проверено {graded.length} из {chain.length} тестов</small></div>
      <details className="day-quiz-history"><summary><strong>Предыдущие тесты</strong><ChevronDown size={18} aria-hidden="true" /></summary><div className="day-quiz-history-body"><table className="day-quiz-history-table" aria-label="История результатов"><thead><tr><th>Тест</th><th>Верно</th><th>Баллы, %</th><th><span className="sr-only">Время</span></th></tr></thead><tbody>{earlier.map(test => {
        const counts = quizAnswerCounts(test)
        const errors = counts ? counts.incorrect + counts.partial + counts.unanswered : undefined
        return <Fragment key={test.token}><tr data-test-id={test.testId} className={openReviewToken === test.token ? 'selected' : ''}><td><button type="button" className="day-quiz-history-select" title={test.title} aria-expanded={openReviewToken === test.token} aria-controls={openReviewToken === test.token ? reviewPanelId(test) : undefined} onClick={() => reviewButton(test)}><strong>{test.title}</strong><small>{errors != null ? <span className={errors ? 'day-quiz-wrong' : ''}>{errors} {errorWord(errors)}</span> : <span>{test.status === 'submitted' ? 'Ответы уточняются' : 'Не завершён'}</span>} · <ResultPoints points={test.points} maxPoints={test.maxPoints} compact /></small></button></td><td><span className={counts?.correct ? "day-quiz-correct" : "day-quiz-denominator"}>{counts?.correct ?? '—'}</span><span className="day-quiz-denominator">/{test.total}</span></td><td><ResultBadge input={inputFor(test)} compact /><ResultMeter input={inputFor(test)} label={`Баллы: ${test.title}`} compact /></td><td>{timeButton(test)}</td></tr>
          {openTimeToken === test.token && <tr className="day-quiz-history-time-row"><td colSpan={4}><QuizTimeDetails test={test} id={timePanelId(test)} /></td></tr>}
        </Fragment>
      })}</tbody></table>{earlier.map(test => openReviewToken === test.token && <div key={test.token} id={reviewPanelId(test)}><QuizAttemptReview test={test} parent={parent} linksEnabled={linksEnabled} /></div>)}</div></details>
    </>}
  </section>
}
