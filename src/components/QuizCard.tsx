import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, Clock3, Copy, ExternalLink, RotateCcw } from 'lucide-react'
import type { QuizCardAttempt } from '@/lib/quizCardViewModel'
import { quizPassed } from '@/lib/quizCompletion'
import { requestQuizFollowup } from '@/lib/store'
import { setQuizRequired } from '@/lib/store'
import StatusIcon from './StatusIcon'
import RequirementSwitch from './RequirementSwitch'
import './QuizCard.css'

function scoreNumber(value: number) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value) }
function questionWord(count: number) { const last = count % 10; const lastTwo = count % 100; return lastTwo >= 11 && lastTwo <= 14 ? 'вопросов' : last === 1 ? 'вопрос' : last >= 2 && last <= 4 ? 'вопроса' : 'вопросов' }

/** Firestore Timestamp, cached seconds and older ISO dates share one display path.
 * @see ../../docs/product/quizzes.md#attempt-time */
function quizTime(value: unknown): Date | undefined {
  let date: unknown
  if (value instanceof Date) date = value
  else if (typeof value === 'string' || typeof value === 'number') date = new Date(value)
  else if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') date = value.toDate()
  else if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') date = new Date(value.seconds * 1000)
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : undefined
}

const quizTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
})

function QuizTimeDetails({ test, id }: { test: QuizCardAttempt; id: string }) {
  const row = (label: string, value: unknown, missing: string) => {
    const date = quizTime(value)
    return <div key={label}><dt>{label}</dt><dd>{date ? <time dateTime={date.toISOString()}>{quizTimeFormatter.format(date)}</time> : missing}</dd></div>
  }
  return <div className="day-quiz-time-details" id={id} role="region" aria-label={`Время теста «${test.title}»`}>
    <dl>
      {row('Создан', test.createdAt, 'Время неизвестно')}
      {row('Начат', test.startedAt, test.status === 'open' && !test.answered ? 'Не начат' : 'Время неизвестно')}
      {row('Последнее изменение', test.updatedAt, test.status === 'open' && !test.answered ? 'Не изменялся' : 'Время неизвестно')}
      {row('Завершён', test.submittedAt, test.status === 'open' ? 'Не завершён' : 'Время неизвестно')}
    </dl>
  </div>
}

/** One quiz projection for a subject task, a standalone test and the test list.
 * Content and attempt history come from Firebase; presentation never depends on subject.
 * @see ../../docs/product/card-generation-policy.md#quiz-adapter
 * @see ../../docs/product/quizzes.md#followup-request
 * @see ../../docs/product/quizzes.md#optional-quiz
 * @see ../../docs/product/quizzes.md#attempt-time
 * @see ../../docs/product/status-presentation.md#components */
export function QuizProgress({ test }: { test: QuizCardAttempt }) {
  const answered = Math.min(test.answered, test.total)
  const remaining = Math.max(0, test.total - answered)
  const scored = test.status === 'submitted' && test.points != null && test.maxPoints != null && test.maxPoints > 0
  const percentage = scored ? Math.round(test.points! / test.maxPoints! * 100) : null
  const label = test.status === 'submitted'
    ? scored ? `Результат · ${scoreNumber(test.points!)} из ${scoreNumber(test.maxPoints!)} баллов · ${percentage}%` : 'Тест отправлен · результат уточняется'
    : answered ? `В процессе · отвечено ${answered} из ${test.total} · осталось ${remaining}`
      : `${test.total} ${questionWord(test.total)}`
  return <div className="day-test-progress">
    <span>{label}</span>
    {(scored || test.status !== 'submitted') && <div className="day-test-track" role="progressbar" aria-label={scored ? 'Результат теста в процентах' : 'Ответы на вопросы теста'} aria-valuemin={0} aria-valuemax={scored ? 100 : test.total} aria-valuenow={scored ? percentage! : answered}>
      <span style={{ width: `${scored ? percentage : test.total ? answered / test.total * 100 : 0}%` }} />
    </div>}
  </div>
}

export default function QuizCard({ chain, parent, context = 'Самопроверка', assignment, materials, extraActions, id, onOpen, allowFollowupRequest = true }: {
  chain: QuizCardAttempt[]; parent: boolean; context?: string; assignment?: ReactNode; materials?: ReactNode; extraActions?: ReactNode; id?: string; onOpen?: () => void; allowFollowupRequest?: boolean;
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [requestedLocally, setRequestedLocally] = useState(false)
  const [savingRequirement, setSavingRequirement] = useState(false)
  const [requirementError, setRequirementError] = useState('')
  const [openTimeToken, setOpenTimeToken] = useState<string | null>(null)
  const timeBaseId = useId()
  const latest = chain.at(-1)
  if (!latest) return null
  const root = chain[0]
  const required = !root.familyOptional
  const earlier = chain.slice(0, -1)
  const graded = earlier.filter((test) => test.status === 'submitted' && test.points != null && test.maxPoints != null)
  const points = graded.reduce((sum, test) => sum + (test.points ?? 0), 0)
  const max = graded.reduce((sum, test) => sum + (test.maxPoints ?? 0), 0)
  const href = parent && latest.status !== 'submitted' && latest.previewToken ? `#/preview/${latest.slug}~${latest.previewToken}` : `#/t/${latest.slug}~${latest.token}`
  const label = parent ? latest.status === 'submitted' ? 'Результат' : 'Посмотреть вопросы' : latest.status === 'submitted' ? 'Результат' : latest.answered ? 'Продолжить тест' : 'Пройти тест'
  const hasScore = latest.status === 'submitted' && latest.points != null && latest.maxPoints != null && latest.maxPoints > 0
  const followupRequested = Boolean(latest.followupRequested || requestedLocally)
  const scoreLabel = hasScore ? `${Math.round(latest.points! / latest.maxPoints! * 100)}% · ${scoreNumber(latest.points!)} из ${scoreNumber(latest.maxPoints!)}` : latest.status === 'submitted' ? 'Результат уточняется' : `${latest.answered} из ${latest.total}`
  const scoreStatus = hasScore ? quizPassed({ points: latest.points!, maxPoints: latest.maxPoints! }) && !followupRequested ? 'complete' : 'partial'
    : latest.status === 'submitted' ? 'waiting' : latest.answered ? 'started' : 'ready'
  const timePanelId = (test: QuizCardAttempt) => `${timeBaseId}-${test.token}-time`
  const timeButton = (test: QuizCardAttempt) => <button type="button" className="day-quiz-time-trigger" aria-label={`${openTimeToken === test.token ? 'Скрыть' : 'Показать'} время теста «${test.title}»`} aria-controls={openTimeToken === test.token ? timePanelId(test) : undefined} aria-expanded={openTimeToken === test.token} onClick={() => setOpenTimeToken((current) => current === test.token ? null : test.token)}><Clock3 size={17} aria-hidden="true" /></button>
  return <section className="day-quiz-lineage" id={id} aria-label={`Самопроверки: ${context}`}>
    <div className="day-quiz-lineage-head"><strong>{context === 'Самопроверка' ? context : `Самопроверка: ${context}`}</strong><div className="day-quiz-lineage-meta"><span className="day-quiz-score-time"><span className={`day-quiz-lineage-score ${scoreStatus}`} aria-label={latest.status === 'submitted' ? scoreLabel : `${latest.answered ? 'В процессе' : 'Не начат'} · ${latest.answered} из ${latest.total} ответов`}><StatusIcon status={scoreStatus} size={14} />{scoreLabel}</span>{timeButton(latest)}</span>{latest.status === 'open' && (parent ? <span className="day-quiz-requirement"><span>{required ? 'Обязателен' : 'По желанию'}</span><RequirementSwitch checked={required} disabled={savingRequirement} label={`Учитывать тест «${latest.title}» в семейном плане`} onChange={(next) => { setSavingRequirement(true); setRequirementError(''); void setQuizRequired(root.rootToken ?? root.token, latest.token, next).catch((cause) => setRequirementError(cause instanceof Error ? cause.message : 'Не удалось сохранить выбор.')).finally(() => setSavingRequirement(false)) }} /></span> : !required && <span className="day-quiz-optional-label">По желанию</span>)}</div></div>
    {openTimeToken === latest.token && <QuizTimeDetails test={latest} id={timePanelId(latest)} />}
    <div className="day-quiz-lineage-current">{latest.status === 'submitted' && earlier.length > 0 && <small>Последний тест</small>}<h3>{latest.title}</h3>{latest.description && <p>{latest.description}</p>}
      {assignment}
      <QuizProgress test={latest} />
      <div className="day-quiz-lineage-actions">{parent && allowFollowupRequest && hasScore && latest.points! < latest.maxPoints! && <button type="button" className="day-quiz-copy" disabled={requesting || followupRequested} aria-label={followupRequested ? 'Связанный тест запрошен' : 'Создать связанный тест по ошибкам'} title={followupRequested ? 'Связанный тест запрошен' : 'Создать связанный тест по ошибкам'} onClick={() => { setRequesting(true); setRequestError(''); void requestQuizFollowup(latest.token, latest.testId).then(() => setRequestedLocally(true)).catch((cause) => setRequestError(cause instanceof Error ? cause.message : 'Не удалось отправить запрос.')).finally(() => setRequesting(false)) }}><RotateCcw size={17} aria-hidden="true" /></button>}<a className="day-quiz-link" href={href} onClick={onOpen}>{label} <ExternalLink size={15} aria-hidden="true" /></a>{parent && <button type="button" className="day-quiz-copy" aria-label="Скопировать ссылку ребёнку" title="Скопировать ссылку ребёнку" onClick={() => void navigator.clipboard.writeText(new URL(`#/t/${latest.slug}~${latest.token}`, window.location.href).href).then(() => { setCopied(true); setCopyError('') }).catch(() => setCopyError('Не удалось скопировать ссылку.'))}><Copy size={16} aria-hidden="true" /></button>}</div>
      {followupRequested && <small role="status">Работа над ошибками запрошена · ждём новый тест</small>}{requestError && <small role="alert">{requestError}</small>}{savingRequirement && <small role="status">Сохраняем выбор…</small>}{requirementError && <small role="alert">{requirementError}</small>}
      {copied && <small role="status">Ссылка скопирована</small>}{copyError && <small role="alert">{copyError}</small>}
      {materials && <details className="day-quiz-materials"><summary>Условие и страницы учебника <ChevronDown size={15} aria-hidden="true" /></summary><div>{materials}</div></details>}
      {extraActions && <div className="day-quiz-extra-actions">{extraActions}</div>}
    </div>
    {earlier.length > 0 && <details className="day-quiz-history"><summary><span><strong>Предыдущие тесты</strong><small>{earlier.length} {earlier.length === 1 ? 'тест' : earlier.length < 5 ? 'теста' : 'тестов'}{max ? ` · ${scoreNumber(points)} из ${scoreNumber(max)} баллов` : ''}</small></span>{max > 0 && <span className={`day-quiz-history-score ${quizPassed({ points, maxPoints: max }) ? 'complete' : ''}`} aria-label={`${Math.round(points / max * 100)} процентов набранных баллов`}><i style={{ width: `${Math.round(points / max * 100)}%` }} />{Math.round(points / max * 100)}%</span>}<ChevronDown size={18} aria-hidden="true" /></summary><div className="day-quiz-history-body">{earlier.map((test) => <div key={test.token}><div className="day-quiz-history-row"><strong>{test.title}</strong><span>{test.status === 'submitted' ? test.points == null ? 'Отправлен · балл уточняется' : `${scoreNumber(test.points)} из ${scoreNumber(test.maxPoints!)} баллов` : 'Не завершён'}</span>{timeButton(test)}<a href={parent && test.status !== 'submitted' && test.previewToken ? `#/preview/${test.slug}~${test.previewToken}` : `#/t/${test.slug}~${test.token}`}>{test.status === 'submitted' ? 'Результат' : 'Посмотреть вопросы'} <ExternalLink size={13} aria-hidden="true" /></a></div>{openTimeToken === test.token && <QuizTimeDetails test={test} id={timePanelId(test)} />}</div>)}</div></details>}
  </section>
}
