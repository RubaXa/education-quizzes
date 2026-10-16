/**
 * @see ../docs/services/web-app/README.md
 */
/**
 * @see ../docs/product/README.md
 */
import { useEffect, useRef, useState } from 'react'
import { getAuth } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { ArrowLeft, CircleHelp, ClipboardCopy, Clock3, RefreshCw, Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/CodeBlock'
import { ReadingCard, ThemeFrame, ThemeHero } from '@/components/SubjectTheme'
import { QuizTextAnswer } from '@/components/QuizTextAnswer'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { countAnswered, grade, summarize } from '@/lib/quiz'
import { sharedQuestionTopic } from '@/lib/questionTopicPresentation'
import { buildFollowUpPrompt } from '@/lib/followup'
import { WriteQueue } from '@/lib/writeQueue'
import { readCachedQuiz, readQuizDraft, rememberQuizStudent, wasQuizStudent, writeCachedQuiz, writeQuizDraft } from '@/lib/quizDraft'
import { readLocalQuiz, writeLocalQuizAssignment, writeLocalQuizDraft } from '@/lib/quizLocalStore'
import type { Answer, AnswerKey, Assignment, ManualReview, QuizQuestion, QuizVisual } from '@/lib/quiz'
import type { BoardDetails } from '@/lib/store'
import type { QuizOutcome } from '@/lib/watchQuizOutcome'
import { clearPersonalSession, loadPersonalProfile, readCachedPersonalContext, readLastPersonalDashboardRoute, rememberPersonalDashboardRoute, restorePersonalSession } from '@/lib/personalAccess'
import { db } from '@/lib/firebase'
import DayPage from './DayPage'
import DayDashboard from './DayDashboard'
import { PwaConnectionNotice, PwaInstallButton, PwaUpdateNotice } from './components/PwaControls'
import { PersonalEntry } from './components/PersonalEntry'
import NotificationBell from './components/NotificationBell'
import ResultCard from './components/QuizResultCard'
import { ResultBadge, ResultMeter, ResultPoints } from './components/ui/result'
import UiKit from './UiKit'
import { ConnectionInvite } from './components/ConnectionInvite'
import EducationImage from './components/EducationImage'
import QuizCard from './components/QuizCard'
import { quizRoot, type QuizCardAttempt } from '@/lib/quizCardViewModel'
import { reportUiError } from '@/lib/uiErrors'
import './App.css'

type Route = { kind: 'test' | 'preview' | 'dashboard' | 'my' | 'review' | 'day' | 'day-parent' | 'days' | 'days-parent' | 'enter' | 'connect'; token: string } | { kind: 'home' | 'ui-kit' }

const storeModule = () => import('@/lib/store')
const loadPreview = async (token: string) => (await storeModule()).loadPreview(token)
const watchAssignment = async (token: string, onChange: Parameters<Awaited<ReturnType<typeof storeModule>>['watchAssignment']>[1], onError: (error: Error) => void) => (await storeModule()).watchAssignment(token, onChange, onError)
const watchAnswerKey = async (token: string, onChange: (key: AnswerKey) => void, onError: (error: Error) => void) => (await storeModule()).watchAnswerKey(token, onChange, onError)
const watchReview = async (token: string, onChange: (review: ManualReview | undefined) => void, onError: (error: Error) => void) => (await storeModule()).watchReview(token, onChange, onError)
const watchQuizOutcome = async (token: string, onChange: Parameters<typeof import('@/lib/watchQuizOutcome')['watchQuizOutcome']>[1], onError: (error: Error) => void) => (await import('@/lib/watchQuizOutcome')).watchQuizOutcome(token, onChange, onError)
const watchDashboard = async (token: string, onChange: Parameters<Awaited<ReturnType<typeof storeModule>>['watchDashboard']>[1], onError: (error: Error) => void) => (await storeModule()).watchDashboard(token, onChange, onError)
const watchViewed = async (token: string, onChange: (ids: Set<string>) => void, onError: (error: Error) => void) => (await storeModule()).watchViewed(token, onChange, onError)
const markViewed = async (boardToken: string, assignmentToken: string) => (await storeModule()).markViewed(boardToken, assignmentToken)
const saveDraft = async (token: string, changedAnswers: Record<string, Answer>, started: boolean) => (await storeModule()).saveDraft(token, changedAnswers, started)
const submitAssignment = async (token: string) => (await storeModule()).submitAssignment(token)

/**
 * Выбирает страницу и представление по ссылке с отдельным токеном доступа.
 * @see ../docs/modules/families/access-and-state.md#routes
 */
function routeFromHash(): Route {
  const [, kind, raw = ''] = location.hash.split('/')
  if (kind === 'ui-kit') return { kind: 'ui-kit' }
  const token = raw.includes('~') ? raw.slice(raw.lastIndexOf('~') + 1) : raw
  if ((kind === 't' || kind === 'preview' || kind === 'dashboard' || kind === 'my' || kind === 'review' || kind === 'day' || kind === 'day-parent' || kind === 'days' || kind === 'days-parent' || kind === 'enter' || kind === 'connect') && token) {
    return { kind: kind === 't' ? 'test' : kind, token }
  }
  return { kind: 'home' }
}

/** @see ../docs/modules/assessments/quizzes.md#quiz-navigation */
function quizReturnHash(value: unknown): string {
  if (typeof value !== 'string') return '#/'
  if (value === '#/') return value
  return /^#\/(?:day|day-parent|days|days-parent|my|review|dashboard)\/[A-Za-z0-9_-]+$/.test(value) ? value : '#/'
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if ('code' in error && error.code === 'permission-denied') {
      reportUiError(error, 'Доступ к странице')
      return 'Доступ к этой ссылке закрыт. Проверьте адрес или попросите новую ссылку.'
    }
    return reportUiError(error, 'Данные страницы')
  }
  return reportUiError(error, 'Данные страницы')
}

function wordForm(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100
  const last = n % 10
  if (!Number.isInteger(count) || (n >= 11 && n <= 14)) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/** @see ../docs/shared/design/README.md#shell
 *  @see ../docs/modules/school-diary/day-page.md#day-navigation
 *  @see ../docs/modules/assessments/quizzes.md#quiz-navigation */
function Shell({ children, dayRoute = false, quizBack, onHeaderTarget }: { children: React.ReactNode; dayRoute?: boolean; quizBack?: string; onHeaderTarget: (target: HTMLDivElement | null) => void }) {
  return (
    <div className={`app-shell${dayRoute ? ' day-route' : ''}`}>
      <PwaUpdateNotice />
      <PwaConnectionNotice />
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Education — на главную"><span className="brand-mark">✳</span><span className="brand-long">Учусь и проверяю</span><span className="brand-short">Education</span></a>
        <div id="day-header-return" ref={onHeaderTarget} />
        {quizBack && <a className="quiz-back-link" href={quizBack}><ArrowLeft size={17} aria-hidden="true" /> Назад</a>}
        <div className="notification-bell-slot"><NotificationBell routeKey={location.hash} /></div>
        <div className="header-actions"><span className="header-note">Маленькие шаги. Большой прогресс.</span><PwaInstallButton /></div>
      </header>
      <main className="page-wrap">{children}</main>
    </div>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="mx-auto max-w-xl border-rose-200 bg-rose-50/70">
      <CardHeader><CardTitle>Не получилось открыть страницу</CardTitle><CardDescription>{message}</CardDescription></CardHeader>
      {onRetry && <CardContent><Button variant="outline" onClick={onRetry}><RefreshCw /> Повторить</Button></CardContent>}
    </Card>
  )
}

/**
 * Показывает один вопрос и редактируемый ответ в назначенном тесте.
 * @see ../docs/modules/assessments/quizzes.md#quiz-runner
 * @see ../docs/modules/assessments/quizzes.md#question-copy
 */
function QuestionCard({
  question,
  index,
  answer,
  onAnswer,
  subject,
  visual,
  disabled = false,
  showTopic = true,
}: {
  question: QuizQuestion
  index: number
  answer?: Answer
  onAnswer: (value: Answer) => void
  subject: string
  visual?: QuizVisual
  disabled?: boolean
  showTopic?: boolean
}) {
  const optionList = question.options ?? []
  const asString = typeof answer === 'string' ? answer : ''
  const asArray = Array.isArray(answer) ? answer : []

  return (
    <Card className="question-card border-0 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="secondary">Вопрос {index + 1}</Badge>
          <span className="text-sm text-muted-foreground">{question.points} {wordForm(question.points, 'балл', 'балла', 'баллов')}</span>
        </div>
        <CardTitle className="text-xl leading-snug sm:text-2xl">{question.prompt}</CardTitle>
        {showTopic && question.topic && <CardDescription>Тема: {question.topic}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {question.code && <CodeBlock code={question.code} />}
        {question.imageUrl && <EducationImage className="question-image" source={question.imageUrl} alt={question.imageAlt ?? 'Иллюстрация к вопросу'} aspectRatio="16 / 9" />}
        {(question.kind === 'single' || question.kind === 'figure') && (
          <RadioGroup value={asString} onValueChange={onAnswer} disabled={disabled} className="gap-3">
            {optionList.map((option) => (
              <label key={option.id} className="option-tile">
                <RadioGroupItem value={option.id} aria-label={option.label} />
                <span className="min-w-0 flex-1">
                  {option.imageUrl && <EducationImage className="option-image" source={option.imageUrl} alt={option.imageAlt ?? option.label} aspectRatio="4 / 3" />}
                  <span>{option.label}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}
        {question.kind === 'multiple' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Можно выбрать несколько вариантов.</p>
            {optionList.map((option) => (
              <label key={option.id} className="option-tile">
                <Checkbox
                  checked={asArray.includes(option.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onAnswer(checked ? [...asArray, option.id] : asArray.filter((item) => item !== option.id))}
                />
                <span className="min-w-0 flex-1">{option.label}</span>
              </label>
            ))}
          </div>
        )}
        {(question.kind === 'short' || question.kind === 'number' || question.kind === 'long') && (
          <QuizTextAnswer kind={question.kind} value={asString} disabled={disabled} subject={subject} visual={visual} onAnswer={onAnswer} />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Собирает результат из ответов, ключа и доступной ручной проверки.
 * @see ../docs/modules/assessments/quizzes.md#quiz-results
 */
function ResultView({ assignment, token }: { assignment: Assignment; token: string }) {
  const [key, setKey] = useState<AnswerKey>()
  const [review, setReview] = useState<ManualReview>()
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let unsubscribers: Array<() => void> = []
    void Promise.all([
      watchAnswerKey(token, (nextKey) => { if (active) { setKey(nextKey); setError('') } }, (cause) => { if (active) setError(describeError(cause)) }),
      watchReview(token, (nextReview) => { if (active) setReview(nextReview) }, (cause) => { if (active) setError(describeError(cause)) }),
    ]).then((next) => { if (active) unsubscribers = next; else next.forEach((unsubscribe) => unsubscribe()) })
    return () => { active = false; unsubscribers.forEach((unsubscribe) => unsubscribe()) }
  }, [token])

  if (!key) return error ? <ErrorCard message={error} /> : <p>Загружаем результат…</p>
  const results = grade(assignment, key, review)
  const summary = summarize(results)

  return (
    <div className="space-y-6">
      {summary.pending === 0 && summary.possible > 0 && summary.earned === summary.possible && <div className="celebration" aria-hidden="true">✦ ✳ ✦ ✴ ✳ ✦</div>}
      <Card className="result-hero border-0 shadow-lg">
        <CardContent className="space-y-5 py-8 sm:py-10">
          <Badge variant="secondary"><Sparkles className="size-3" /> Работа отправлена</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{summary.pending ? 'Хорошее начало!' : 'Готово!'}</h1>
          <p className="max-w-2xl text-muted-foreground">{assignment.title}</p>
          <div className="score-panel">
            <strong className="text-4xl sm:text-5xl"><ResultPoints points={summary.pending ? undefined : summary.earned} maxPoints={summary.possible} /></strong>
            <ResultBadge input={summary.pending ? {kind:'waiting'} : {kind:'score',points:summary.earned,maxPoints:summary.possible}} />
          </div>
          <ResultMeter input={summary.pending ? {kind:'waiting'} : {kind:'score',points:summary.earned,maxPoints:summary.possible}} label="Процент набранных баллов" />
          {summary.skipped > 0 && <p className="text-sm text-muted-foreground">Пропущено без оценки: {summary.skipped} из {assignment.questions.length}.</p>}
          {summary.pending > 0 && <p className="text-sm text-muted-foreground">Итог предварительный. Полный разбор появится по этой же ссылке после проверки.</p>}
        </CardContent>
      </Card>
      <h2 className="text-xl font-semibold sm:text-2xl">Разбор по вопросам</h2>
      <div className="space-y-4">{results.map((result, index) => <ResultCard key={result.question.id} result={result} index={index} />)}</div>
    </div>
  )
}

/**
 * Ведёт попытку, последовательное сохранение ответов и отправку теста.
 * @see ../docs/modules/assessments/quizzes.md#quiz-runner
 * @see ../docs/modules/school-diary/day-page.md#test-progress
 */
function QuizRunner({ token }: { token: string }) {
  const [assignment, setAssignment] = useState<Assignment>()
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [localBackupAvailable, setLocalBackupAvailable] = useState(true)
  const [serverConfirmed, setServerConfirmed] = useState(false)
  const answersRef = useRef<Record<string, Answer>>({})
  const serverAnswersRef = useRef<Record<string, Answer>>({})
  const dirtyAnswers = useRef<Record<string, { value: Answer; revision: number }>>({})
  const answerRevision = useRef(0)
  const writeQueue = useRef(new WriteQueue())
  const pendingWrites = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount = useRef(0)
  const firstSnapshot = useRef(false)
  const startedRef = useRef(false)

  function persistDirty() {
    const dirty = Object.fromEntries(Object.entries(dirtyAnswers.current).map(([id, change]) => [id, change.value]))
    const legacySaved = writeQuizDraft(token, dirty)
    setLocalBackupAvailable(legacySaved)
    void writeLocalQuizDraft(token, dirty).then(() => setLocalBackupAvailable(true)).catch(() => {
      if (!legacySaved) setLocalBackupAvailable(false)
    })
  }

  function scheduleSave(delay = 900) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      queueSave()
    }, delay)
  }

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let watchRetry: ReturnType<typeof setTimeout> | undefined
    let watchFailures = 0
    const cached = readCachedQuiz(token)
    if (cached) {
      setAssignment(cached)
      serverAnswersRef.current = cached.answers ?? {}
    }
    const local = readQuizDraft(token)
    for (const [id, value] of Object.entries(local)) {
      dirtyAnswers.current[id] = { value, revision: ++answerRevision.current }
    }
    if (cached || Object.keys(local).length) {
      answersRef.current = { ...(cached?.answers ?? {}), ...local }
      setAnswers(answersRef.current)
      setUnsaved(true)
    }
    function retryWatch(cause: unknown) {
      if (!active) return
      setServerConfirmed(false)
      setError(describeError(cause))
      unsubscribe?.()
      unsubscribe = undefined
      if (watchRetry) clearTimeout(watchRetry)
      watchFailures += 1
      watchRetry = setTimeout(() => { void connect() }, Math.min(120_000, 5_000 * 2 ** Math.min(watchFailures - 1, 5)))
    }
    async function connect() {
      try {
        const next = await watchAssignment(token, (data, confirmed) => {
      if (!active) return
      setAssignment(data)
      setServerConfirmed(confirmed)
      serverAnswersRef.current = data.answers ?? {}
      if (confirmed) {
        watchFailures = 0
        startedRef.current = startedRef.current || data.startedAt != null
        writeCachedQuiz(token, data)
        void writeLocalQuizAssignment(token, data).catch(() => {})
        if (!Object.keys(dirtyAnswers.current).length) setError('')
      }
      if (confirmed && data.status === 'submitted') {
        dirtyAnswers.current = {}
        writeQuizDraft(token, {})
        void writeLocalQuizDraft(token, {}).catch(() => {})
      }
      const pending = Object.fromEntries(Object.entries(dirtyAnswers.current).map(([id, change]) => [id, change.value]))
      answersRef.current = { ...serverAnswersRef.current, ...pending }
      setAnswers(answersRef.current)
      setUnsaved(!confirmed || Object.keys(pending).length > 0)
      if (confirmed && !firstSnapshot.current) {
        firstSnapshot.current = true
        if (data.status === 'open' && Object.keys(pending).length) scheduleSave(1200)
      }
        }, retryWatch)
        if (active) unsubscribe = next
        else next()
      } catch (cause) { retryWatch(cause) }
    }
    // Import the existing synchronous emergency copy into IndexedDB before
    // opening the network stream. Old clients can still read localStorage.
    void (async () => {
      try {
        const indexed = await readLocalQuiz(token)
        if (!active) return
        if (!cached && indexed.assignment) {
          setAssignment(indexed.assignment)
          serverAnswersRef.current = indexed.assignment.answers ?? {}
          answersRef.current = { ...serverAnswersRef.current, ...Object.fromEntries(Object.entries(dirtyAnswers.current).map(([id, change]) => [id, change.value])) }
          setAnswers(answersRef.current)
        }
        if (!Object.keys(local).length && Object.keys(indexed.draft).length) {
          for (const [id, value] of Object.entries(indexed.draft)) {
            if (!dirtyAnswers.current[id]) dirtyAnswers.current[id] = { value, revision: ++answerRevision.current }
          }
          answersRef.current = { ...serverAnswersRef.current, ...Object.fromEntries(Object.entries(dirtyAnswers.current).map(([id, change]) => [id, change.value])) }
          setAnswers(answersRef.current)
          setUnsaved(true)
          writeQuizDraft(token, indexed.draft)
        }
        if (cached) void writeLocalQuizAssignment(token, cached).catch(() => {})
        if (Object.keys(local).length) void writeLocalQuizDraft(token, local).catch(() => {})
      } catch { /* localStorage remains the recovery copy when IndexedDB is unavailable. */ }
      if (active) void connect()
    })()
    const retryOnline = () => {
      if (watchRetry) { clearTimeout(watchRetry); watchRetry = undefined; void connect() }
      if (Object.keys(dirtyAnswers.current).length) scheduleSave(0)
    }
    window.addEventListener('online', retryOnline)
    return () => {
      active = false
      unsubscribe?.()
      if (watchRetry) clearTimeout(watchRetry)
      window.removeEventListener('online', retryOnline)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [token])

  function queueSave() {
    if (pendingWrites.current > 0 || !firstSnapshot.current || Object.keys(dirtyAnswers.current).length === 0) return
    setSaving(true)
    pendingWrites.current += 1
    const write = writeQueue.current.add(async () => {
      const pending = { ...dirtyAnswers.current }
      const patch = Object.fromEntries(Object.entries(pending).map(([id, change]) => [id, change.value]))
      if (Object.keys(patch).length === 0) return
      await saveDraft(token, patch, startedRef.current)
      startedRef.current = true
      serverAnswersRef.current = { ...serverAnswersRef.current, ...patch }
      for (const [id, change] of Object.entries(pending)) {
        if (dirtyAnswers.current[id]?.revision === change.revision) delete dirtyAnswers.current[id]
      }
      persistDirty()
      setUnsaved(Object.keys(dirtyAnswers.current).length > 0)
      setError('')
      retryCount.current = 0
    })
    void write.catch((cause) => {
      setError(`Не удалось сохранить ответ: ${describeError(cause)}`)
      retryCount.current += 1
    }).finally(() => {
      pendingWrites.current -= 1
      if (pendingWrites.current === 0) {
        setSaving(false)
        if (Object.keys(dirtyAnswers.current).length === 0) {
          answersRef.current = serverAnswersRef.current
          setAnswers(answersRef.current)
        } else {
          scheduleSave(retryCount.current ? Math.min(120_000, 5_000 * 2 ** Math.min(retryCount.current - 1, 5)) : 900)
        }
      }
    })
  }

  function updateAnswer(questionId: string, value: Answer) {
    const next = { ...answersRef.current, [questionId]: value }
    answersRef.current = next
    dirtyAnswers.current[questionId] = { value, revision: ++answerRevision.current }
    setAnswers(next)
    setUnsaved(true)
    persistDirty()
    scheduleSave(retryCount.current ? Math.min(120_000, 5_000 * 2 ** Math.min(retryCount.current - 1, 5)) : 900)
  }

  async function submit() {
    if (!assignment || !window.confirm('Отправить работу? После этого ответы нельзя будет изменить.')) return
    setSubmitting(true)
    try {
      await writeQueue.current.settled()
      if (Object.keys(dirtyAnswers.current).length > 0) throw new Error('Сначала сохраните все ответы.')
      await submitAssignment(token)
      setError('')
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !assignment) return <ErrorCard message={error} />
  if (!assignment) return <Card className="mx-auto max-w-xl"><CardContent className="py-10 text-center">Загружаем тест…</CardContent></Card>
  if (assignment.status === 'submitted') return <ThemeFrame subject={assignment.subject} visual={assignment.visual}><ResultView assignment={assignment} token={token} /></ThemeFrame>

  const answered = countAnswered({ ...assignment, answers })
  const progress = assignment.questions.length ? Math.round(100 * answered / assignment.questions.length) : 0
  const sharedTopic = sharedQuestionTopic(assignment.questions)

  return (
    <ThemeFrame subject={assignment.subject} visual={assignment.visual}>
      <div className="space-y-6">
      <ThemeHero subject={assignment.subject} visual={assignment.visual} title={assignment.title} description={assignment.description}>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-2"><CircleHelp className="size-4" /> {assignment.questions.length} {wordForm(assignment.questions.length, 'вопрос', 'вопроса', 'вопросов')}</span>
          <span className="flex items-center gap-2"><Clock3 className="size-4" /> Можно продолжить позже по этой ссылке</span>
        </div>
      </ThemeHero>
      <ReadingCard reading={assignment.reading} />
      <div className="sticky-progress rounded-2xl bg-white/95 px-5 py-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex justify-between text-sm"><span>Ваш прогресс</span><strong>{answered} из {assignment.questions.length}</strong></div>
        <Progress value={progress} />
      </div>
      {sharedTopic && <p className="text-sm text-muted-foreground">Тема вопросов: {sharedTopic}</p>}
      <div className="space-y-5">{assignment.questions.map((question, index) => (
        <QuestionCard key={question.id} question={question} index={index} answer={answers[question.id]} onAnswer={(value) => updateAnswer(question.id, value)} subject={assignment.subject} visual={assignment.visual} showTopic={!sharedTopic} />
      ))}</div>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="flex flex-col items-start justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{unsaved ? localBackupAvailable ? 'Черновик сохранён на этом устройстве; отправка в Firebase не подтверждена' : 'Черновик не удалось сохранить на устройстве — скопируйте ответы и не закрывайте страницу' : saving ? 'Сохраняем ответ в Firebase…' : 'Все выбранные ответы сохранены в Firebase'}</span>
          {unsaved && !saving && serverConfirmed && <Button variant="outline" onClick={() => { retryCount.current = 0; if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = null; queueSave() }}>Повторить сохранение</Button>}
        </div>
        <Button size="lg" disabled={submitting || saving || unsaved || !serverConfirmed} onClick={submit}><Send /> {submitting ? 'Отправляем…' : 'Завершить тест'}</Button>
      </div>
      </div>
    </ThemeFrame>
  )
}

/**
 * Показывает вопросы родителю без записи ответов и создания попытки.
 * @see ../docs/modules/assessments/quizzes.md#test-lists
 */
function Preview({ token }: { token: string }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof loadPreview>>>()
  const [error, setError] = useState('')
  useEffect(() => { loadPreview(token).then(setPreview).catch((cause) => setError(describeError(cause))) }, [token])
  if (error) return <ErrorCard message={error} />
  if (!preview) return <p>Загружаем предпросмотр…</p>
  const sharedTopic = sharedQuestionTopic(preview.questions)
  return (
    <ThemeFrame subject={preview.subject} visual={preview.visual}>
      <div className="space-y-6">
      <ThemeHero subject={preview.subject} visual={preview.visual} title={preview.title} description={preview.description} preview />
      <ReadingCard reading={preview.reading} />
      {sharedTopic && <p className="text-sm text-muted-foreground">Тема вопросов: {sharedTopic}</p>}
      {preview.questions.map((question, index) => <QuestionCard key={question.id} question={question} index={index} disabled subject={preview.subject} visual={preview.visual} showTopic={!sharedTopic} onAnswer={() => {}} />)}
      </div>
    </ThemeFrame>
  )
}

/** Parent links and direct student URLs share a read-only result surface. The
 * actual permission to write is enforced by Firestore assignment ownership.
 * @see ../docs/modules/assessments/quizzes.md#parent-read-only
 */
function QuizAccess({ token }: { token: string }) {
  const [student, setStudent] = useState<boolean | null>(null)
  const [assignment, setAssignment] = useState<Assignment>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const session = await restorePersonalSession()
        const profile = session ? await loadPersonalProfile(session) : null
        const isStudent = Boolean(profile?.children.some((child) => child.role === 'student'))
        if (isStudent && session) rememberQuizStudent(token, session.deviceUid)
        if (active) setStudent(isStudent)
      } catch (cause) {
        if (!active) return
        const uid = getAuth().currentUser?.uid
        if (uid && wasQuizStudent(token, uid) && readCachedQuiz(token)) setStudent(true)
        else setError(describeError(cause))
      }
    })()
    return () => { active = false }
  }, [token])
  useEffect(() => {
    if (student !== false) return
    let active = true
    let stop: (() => void) | undefined
    void watchAssignment(token, (value) => { if (active) setAssignment(value) }, (cause) => { if (active) setError(describeError(cause)) }).then((unsubscribe) => { if (active) stop = unsubscribe; else unsubscribe() })
    return () => { active = false; stop?.() }
  }, [student, token])
  if (error) return <ErrorCard message={error} />
  if (student === null) return <p>Проверяем профиль…</p>
  if (student) return <QuizRunner key={token} token={token} />
  if (!assignment) return <p>Загружаем тест для просмотра…</p>
  if (assignment.status === 'submitted') return <ThemeFrame subject={assignment.subject} visual={assignment.visual}><ResultView assignment={assignment} token={token} /></ThemeFrame>
  const sharedTopic = sharedQuestionTopic(assignment.questions)
  return <ThemeFrame subject={assignment.subject} visual={assignment.visual}><div className="space-y-6">
    <ThemeHero subject={assignment.subject} visual={assignment.visual} title={assignment.title} description={assignment.description} preview />
    <ReadingCard reading={assignment.reading} />
    <p className="text-sm text-muted-foreground">Только просмотр: ответы ученика здесь изменить нельзя.</p>
    {sharedTopic && <p className="text-sm text-muted-foreground">Тема вопросов: {sharedTopic}</p>}
    {assignment.questions.map((question, index) => <QuestionCard key={question.id} question={question} index={index} disabled subject={assignment.subject} visual={assignment.visual} showTopic={!sharedTopic} onAnswer={() => {}} />)}
  </div></ThemeFrame>
}

type BoardItem = QuizCardAttempt & {
  board: BoardDetails | null
  subject: string
  position: number | null
  createdAt: { seconds?: number } | null
  submittedAt: { seconds?: number } | null
}

/**
 * Карточка назначения в ученическом или родительском списке тестов.
 * @see ../docs/modules/assessments/quizzes.md#test-lists
 */
function BoardCard({ item, parent = false, unread = false, copied = false, hasContinuation = false, onCopy, onMarkViewed }: {
  item: BoardItem
  parent?: boolean
  unread?: boolean
  copied?: boolean
  hasContinuation?: boolean
  onCopy?: (item: BoardItem) => void
  onMarkViewed?: (token: string) => void
}) {
  const completed = item.status === 'submitted'
  const materials = item.board ? <div className="board-description-content">
    <div><h4>На основе материалов</h4><ul>{item.board.materials.map((material) => <li key={material}>{material}</li>)}</ul></div>
    <div><h4>Что повторить</h4><p>{item.board.review}</p></div>
    <div><h4>Зачем этот тест</h4><p>{item.board.purpose}</p></div>
  </div> : undefined
  return <QuizCard chain={[item]} parent={parent} allowFollowupRequest={!hasContinuation} context={item.subject || 'заданию'} id={`board-quiz-${item.token}`} materials={materials} onOpen={() => { if (unread) onMarkViewed?.(item.token) }} extraActions={<>
    {parent && completed && <Button variant="outline" onClick={() => onCopy?.(item)}><ClipboardCopy /> {copied ? 'Скопировано' : 'Скопировать задание агенту'}</Button>}
    {parent && unread && <Button variant="ghost" onClick={() => onMarkViewed?.(item.token)}>Отметить просмотренным</Button>}
  </>} />

}

/**
 * Живой список назначений и результатов для соответствующей ссылки.
 * @see ../docs/modules/assessments/quizzes.md#test-lists
 */
function Dashboard({ token, parent = false }: { token: string; parent?: boolean }) {
  const [items, setItems] = useState<BoardItem[]>()
  const [seen, setSeen] = useState<Set<string> | undefined>(parent ? undefined : new Set())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let active = true
    let stopIndex: (() => void) | undefined
    const subscriptions = new Map<string, { active: boolean; stop?: () => void }>()
    const outcomes = new Map<string, QuizOutcome>()
    let indexRows: Awaited<ReturnType<typeof import('@/lib/store').loadDashboard>> = []
    const emit = () => {
      if (!active || indexRows.some((item) => !outcomes.has(item.token))) return
      const next = indexRows.map((item): BoardItem => {
        const { assignment, score, results } = outcomes.get(item.token)!
        return {
          ...item,
          testId: assignment.testId,
          linkedToTestId: assignment.linkedToTestId,
          title: item.title || assignment.title,
          description: item.description || assignment.description || '',
          board: item.board,
          subject: item.subject || assignment.subject,
          status: assignment.status,
          answered: countAnswered(assignment),
          total: assignment.questions.length,
          createdAt: (assignment.createdAt ?? item.createdAt) as { seconds?: number } | null,
          submittedAt: assignment.submittedAt as { seconds?: number } | null,
          startedAt: assignment.startedAt, updatedAt: assignment.updatedAt,
          results,
          points: score?.points,
          maxPoints: score?.maxPoints,
          followupRequested: Boolean(assignment.followupRequestedAt),
          familyOptional: Boolean(assignment.familyOptional),
        }
      }).sort((a, b) => (a.position ?? a.createdAt?.seconds ?? 0) - (b.position ?? b.createdAt?.seconds ?? 0))
      setItems(next.map((item) => {
        const root = quizRoot(item, next)
        return { ...item, rootToken: root.token, familyOptional: root.familyOptional }
      }))
      setError('')
    }
    void watchDashboard(token, (index) => {
      indexRows = index
      const needed = new Set(index.map((item) => item.token))
      for (const [id, subscription] of subscriptions) {
        if (needed.has(id)) continue
        subscription.active = false
        subscription.stop?.()
        subscriptions.delete(id)
        outcomes.delete(id)
      }
      for (const item of index) {
        if (subscriptions.has(item.token)) continue
        const subscription: { active: boolean; stop?: () => void } = { active: true }
        subscriptions.set(item.token, subscription)
        void watchQuizOutcome(item.token, (outcome) => {
          if (!active || !subscription.active) return
          outcomes.set(item.token, outcome)
          emit()
        }, (cause) => { if (active) setError(describeError(cause)) }).then((stop) => {
          if (active && subscription.active) subscription.stop = stop
          else stop()
        }).catch((cause) => { if (active) setError(describeError(cause)) })
      }
      emit()
    }, (cause) => { if (active) setError(describeError(cause)) }).then((stop) => {
      if (active) stopIndex = stop
      else stop()
    }).catch((cause) => { if (active) setError(describeError(cause)) })

    let stopViewed: (() => void) | undefined
    if (parent) {
      void watchViewed(token, (next) => { if (active) setSeen(next) }, (cause) => { if (active) setError(describeError(cause)) }).then((stop) => {
        if (active) stopViewed = stop
        else stop()
      }).catch((cause) => { if (active) setError(describeError(cause)) })
    }
    return () => {
      active = false
      stopIndex?.()
      stopViewed?.()
      for (const subscription of subscriptions.values()) { subscription.active = false; subscription.stop?.() }
    }
  }, [token, parent])

  async function copyPrompt(item: BoardItem) {
    try {
      await navigator.clipboard.writeText(buildFollowUpPrompt(item))
      setCopied(item.token)
      setError('')
    } catch (cause) { setError(`Не удалось скопировать: ${describeError(cause)}`) }
  }

  async function markResultViewed(assignmentToken: string) {
    try { await markViewed(token, assignmentToken); setError('') }
    catch (cause) { setError(`Не удалось отметить просмотр: ${describeError(cause)}`) }
  }

  const subjects = [...new Set(items?.map((item) => item.subject) ?? [])]
  const activeCount = items?.filter((item) => item.status !== 'submitted').length ?? 0
  const completedCount = (items?.length ?? 0) - activeCount
  const newResults = seen ? items?.filter((item) => item.status === 'submitted' && !seen.has(item.token))
    .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0)) ?? []
    : []
  const seenResults = items?.filter((item) => item.status === 'submitted' && seen?.has(item.token)) ?? []
  return (
    <div className="space-y-6">
      <div className="intro-card">
        <Badge variant="secondary" className="bg-white/80">{parent ? 'Для родителя · только просмотр' : 'Личный список тестов'}</Badge>
        <h1 className="text-3xl font-bold sm:text-5xl">{parent ? 'Результаты ученика' : 'Мои тесты'}</h1>
        <p className="text-muted-foreground">{parent ? 'Новые результаты появляются сразу после отправки теста. Ответы и прогресс обновляются без перезагрузки.' : 'Здесь видно, что ещё предстоит сделать и сколько вопросов осталось. Открывай тест, когда будешь готов.'}</p>
        {items && <p className="font-medium">{parent ? seen ? `Новых результатов: ${newResults.length} · В работе: ${activeCount}` : 'Загружаем новые результаты…' : `Активных: ${activeCount} · Пройденных: ${completedCount}`}</p>}
      </div>
      <p className="text-sm text-muted-foreground">Изменения в тестах появляются здесь автоматически. Просмотр списка не меняет ответы.</p>
      {error && <ErrorCard message={error} />}
      {!items && <p>Загружаем список…</p>}
      {items?.length === 0 && <Card><CardContent className="py-10 text-center">Тестов пока нет.</CardContent></Card>}
      {parent && newResults.length > 0 && <section className="space-y-3" aria-label="Новые результаты"><h2 className="board-subject-title">Новые результаты</h2>{newResults.map((item) => <BoardCard key={item.token} item={item} parent hasContinuation={items?.some((candidate) => candidate.linkedToTestId === item.testId)} unread copied={copied === item.token} onCopy={copyPrompt} onMarkViewed={markResultViewed} />)}</section>}
      {subjects.map((subject) => {
        const subjectItems = items?.filter((item) => item.subject === subject) ?? []
        const active = subjectItems.filter((item) => item.status !== 'submitted')
        const archived = subjectItems.filter((item) => item.status === 'submitted')
        const reviewed = seenResults.filter((item) => item.subject === subject)
        if (parent && active.length === 0 && reviewed.length === 0) return null
        return <section key={subject} className="space-y-4" aria-label={subject}>
          <h2 className="board-subject-title">{subject}</h2>
          {active.length > 0 && <div className="space-y-3"><h3 className="board-section-title">{parent ? 'В работе' : 'Активные'}</h3>{active.map((item) => <BoardCard key={item.token} item={item} parent={parent} />)}</div>}
          {(parent ? reviewed : archived).length > 0 && <div className="space-y-3"><h3 className="board-section-title">{parent ? 'Просмотренные результаты' : 'Пройденные · архив'}</h3>{(parent ? reviewed : archived).map((item) => <BoardCard key={item.token} item={item} parent={parent} hasContinuation={items?.some((candidate) => candidate.linkedToTestId === item.testId)} copied={copied === item.token} onCopy={copyPrompt} onMarkViewed={markResultViewed} />)}</div>}
        </section>
      })}
    </div>
  )
}

function Home() {
  return <PersonalEntry />
}

/**
 * Связывает страницы дня, теста, предпросмотра и списков в одном приложении.
 * @see ../docs/modules/families/access-and-state.md#routes
 */
function App() {
  const [route, setRoute] = useState<Route>(() => {
    if (!location.hash || location.hash === '#/') {
      const saved = readLastPersonalDashboardRoute()
      if (saved) history.replaceState(history.state, '', `${location.pathname}${location.search}${saved}`)
    }
    return routeFromHash()
  })
  const [headerReturnTarget, setHeaderReturnTarget] = useState<HTMLDivElement | null>(null)
  const [testReturn, setTestReturn] = useState(() => quizReturnHash(history.state?.educationQuizReturnHash))
  useEffect(() => {
    let previousRoute = routeFromHash()
    let previousHash = location.hash
    const updateRoute = () => {
      const nextRoute = routeFromHash()
      if (nextRoute.kind === 'test' || nextRoute.kind === 'preview') {
        if (previousRoute.kind !== 'test' && previousRoute.kind !== 'preview') {
          const returnHash = quizReturnHash(previousHash)
          history.replaceState({ ...history.state, educationQuizReturnHash: returnHash }, '')
          setTestReturn(returnHash)
        } else setTestReturn(quizReturnHash(history.state?.educationQuizReturnHash))
      }
      previousRoute = nextRoute
      previousHash = location.hash
      rememberPersonalDashboardRoute(location.hash)
      setRoute(nextRoute)
    }
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])
  useEffect(() => {
    if (route.kind !== 'days' && route.kind !== 'days-parent') return
    const cached = readCachedPersonalContext()
    const role = route.kind === 'days-parent' ? 'parent' : 'student'
    if (!cached?.profile.children.some((child) => child.role === role && child.dashboardToken === route.token)) return
    let active = true
    let stops: Array<() => void> = []
    const close = () => {
      if (!active) return
      clearPersonalSession()
      window.location.hash = '#/'
    }
    void getAuth().authStateReady().then(() => {
      if (!active) return
      if (getAuth().currentUser?.uid !== cached.session.deviceUid) { close(); return }
      const { session } = cached
      stops = [
        onSnapshot(doc(db, 'accessLinks', session.linkToken), (grant) => {
          if (!grant.metadata.fromCache && (!grant.exists() || grant.data()?.active !== true || grant.data()?.personId !== session.personId)) close()
        }, (cause) => { if (cause.code === 'permission-denied') close() }),
        onSnapshot(doc(db, 'deviceSessions', session.deviceUid), (device) => {
          if (!device.metadata.fromCache && (!device.exists() || device.data()?.linkToken !== session.linkToken)) close()
        }, (cause) => { if (cause.code === 'permission-denied') close() }),
      ]
      for (const familyId of new Set(cached.profile.children.filter((child) => child.role === role && child.dashboardToken === route.token).map((child) => child.familyId))) {
        stops.push(onSnapshot(doc(db, 'families', familyId, 'members', session.personId), (member) => {
          if (!member.metadata.fromCache && (!member.exists() || member.data()?.active !== true || member.data()?.role !== role ||
            !member.data()?.childIds?.includes(cached.profile.children.find((child) => child.familyId === familyId && child.dashboardToken === route.token)?.childId))) close()
        }, (cause) => { if (cause.code === 'permission-denied') close() }))
      }
    })
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [route])
  return <Shell dayRoute={route.kind === 'day' || route.kind === 'day-parent'} quizBack={route.kind === 'test' || route.kind === 'preview' ? testReturn : undefined} onHeaderTarget={setHeaderReturnTarget}>{route.kind === 'ui-kit' ? <UiKit /> : route.kind === 'test' ? <QuizAccess key={route.token} token={route.token} /> : route.kind === 'preview' ? <Preview token={route.token} /> : route.kind === 'dashboard' || route.kind === 'my' || route.kind === 'review' ? <Dashboard key={`${route.kind}-${route.token}`} token={route.token} parent={route.kind === 'review'} /> : route.kind === 'days' || route.kind === 'days-parent' ? <DayDashboard key={`${route.kind}-${route.token}`} token={route.token} parent={route.kind === 'days-parent'} /> : route.kind === 'day' || route.kind === 'day-parent' ? <DayPage key={`${route.kind}-${route.token}`} token={route.token} parent={route.kind === 'day-parent'} headerReturnTarget={headerReturnTarget} /> : route.kind === 'enter' ? <PersonalEntry key={route.token} initialLink={route.token} /> : route.kind === 'connect' ? <ConnectionInvite key={route.token} code={route.token} /> : <Home />}</Shell>
}

export default App
