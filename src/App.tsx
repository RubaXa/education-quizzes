import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, ChevronDown, CircleHelp, ClipboardCopy, Clock3, ExternalLink, RefreshCw, Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/CodeBlock'
import { ReadingCard, ThemeFrame, ThemeHero } from '@/components/SubjectTheme'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { countAnswered, grade, summarize } from '@/lib/quiz'
import { buildFollowUpPrompt } from '@/lib/followup'
import { WriteQueue } from '@/lib/writeQueue'
import type { Answer, AnswerKey, Assignment, ManualReview, QuizQuestion, QuestionResult } from '@/lib/quiz'
import type { BoardDetails } from '@/lib/store'
import { loadPersonalProfile, restorePersonalSession } from '@/lib/personalAccess'
import DayPage from './DayPage'
import DayDashboard from './DayDashboard'
import { PwaConnectionNotice, PwaInstallButton, PwaUpdateNotice } from './components/PwaControls'
import { PersonalEntry } from './components/PersonalEntry'
import './App.css'

type Route = { kind: 'test' | 'preview' | 'dashboard' | 'my' | 'review' | 'day' | 'day-parent' | 'days' | 'days-parent' | 'enter'; token: string } | { kind: 'home' }

const storeModule = () => import('@/lib/store')
const loadPreview = async (token: string) => (await storeModule()).loadPreview(token)
const watchAssignment = async (token: string, onChange: Parameters<Awaited<ReturnType<typeof storeModule>>['watchAssignment']>[1], onError: (error: Error) => void) => (await storeModule()).watchAssignment(token, onChange, onError)
const watchAnswerKey = async (token: string, onChange: (key: AnswerKey) => void, onError: (error: Error) => void) => (await storeModule()).watchAnswerKey(token, onChange, onError)
const watchReview = async (token: string, onChange: (review: ManualReview | undefined) => void, onError: (error: Error) => void) => (await storeModule()).watchReview(token, onChange, onError)
const watchDashboard = async (token: string, onChange: Parameters<Awaited<ReturnType<typeof storeModule>>['watchDashboard']>[1], onError: (error: Error) => void) => (await storeModule()).watchDashboard(token, onChange, onError)
const watchViewed = async (token: string, onChange: (ids: Set<string>) => void, onError: (error: Error) => void) => (await storeModule()).watchViewed(token, onChange, onError)
const markViewed = async (boardToken: string, assignmentToken: string) => (await storeModule()).markViewed(boardToken, assignmentToken)
const saveDraft = async (token: string, changedAnswers: Record<string, Answer>) => (await storeModule()).saveDraft(token, changedAnswers)
const submitAssignment = async (token: string) => (await storeModule()).submitAssignment(token)

/**
 * Выбирает страницу и представление по ссылке с отдельным токеном доступа.
 * @see ../docs/product/access-and-state.md#routes
 */
function routeFromHash(): Route {
  const [, kind, raw = ''] = location.hash.split('/')
  const token = raw.includes('~') ? raw.slice(raw.lastIndexOf('~') + 1) : raw
  if ((kind === 't' || kind === 'preview' || kind === 'dashboard' || kind === 'my' || kind === 'review' || kind === 'day' || kind === 'day-parent' || kind === 'days' || kind === 'days-parent' || kind === 'enter') && token) {
    return { kind: kind === 't' ? 'test' : kind, token }
  }
  return { kind: 'home' }
}

/** @see ../docs/product/quizzes.md#quiz-navigation */
function quizReturnHash(value: unknown): string {
  if (typeof value !== 'string') return '#/'
  if (value === '#/') return value
  return /^#\/(?:day|day-parent|days|days-parent|my|review|dashboard)\/[A-Za-z0-9_-]+$/.test(value) ? value : '#/'
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if ('code' in error && error.code === 'permission-denied') {
      return 'Доступ к этой ссылке закрыт. Проверьте адрес или попросите новую ссылку.'
    }
    return error.message
  }
  return 'Не удалось загрузить данные. Попробуйте ещё раз.'
}

function wordForm(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100
  const last = n % 10
  if (!Number.isInteger(count) || (n >= 11 && n <= 14)) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/** @see ../docs/product/day-page.md#day-navigation
 *  @see ../docs/product/quizzes.md#quiz-navigation */
function Shell({ children, dayRoute = false, quizBack, onHeaderTarget }: { children: React.ReactNode; dayRoute?: boolean; quizBack?: string; onHeaderTarget: (target: HTMLDivElement | null) => void }) {
  return (
    <div className={`app-shell${dayRoute ? ' day-route' : ''}`}>
      <PwaUpdateNotice />
      <PwaConnectionNotice />
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Education — на главную"><span className="brand-mark">✳</span><span className="brand-long">Учусь и проверяю</span><span className="brand-short">Education</span></a>
        <div id="day-header-return" ref={onHeaderTarget} />
        {quizBack && <a className="quiz-back-link" href={quizBack}><ArrowLeft size={17} aria-hidden="true" /> Назад</a>}
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
 * @see ../docs/product/quizzes.md#quiz-runner
 */
function QuestionCard({
  question,
  index,
  answer,
  onAnswer,
  disabled = false,
}: {
  question: QuizQuestion
  index: number
  answer?: Answer
  onAnswer: (value: Answer) => void
  disabled?: boolean
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
        {question.topic && <CardDescription>Тема: {question.topic}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {question.code && <CodeBlock code={question.code} />}
        {question.imageUrl && <img className="question-image" src={question.imageUrl} alt={question.imageAlt ?? 'Иллюстрация к вопросу'} />}
        {(question.kind === 'single' || question.kind === 'figure') && (
          <RadioGroup value={asString} onValueChange={onAnswer} disabled={disabled} className="gap-3">
            {optionList.map((option) => (
              <label key={option.id} className="option-tile">
                <RadioGroupItem value={option.id} aria-label={option.label} />
                <span className="min-w-0 flex-1">
                  {option.imageUrl && <img className="option-image" src={option.imageUrl} alt={option.imageAlt ?? option.label} />}
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
        {(question.kind === 'short' || question.kind === 'number') && (
          <Input
            value={asString}
            disabled={disabled}
            inputMode={question.kind === 'number' ? 'decimal' : 'text'}
            placeholder={question.kind === 'number' ? 'Введите число' : 'Напишите ответ'}
            onChange={(event) => onAnswer(event.target.value)}
            className="h-12 text-base"
          />
        )}
        {question.kind === 'long' && (
          <Textarea
            value={asString}
            disabled={disabled}
            placeholder="Опишите решение или объясните ответ своими словами"
            onChange={(event) => onAnswer(event.target.value)}
            className="min-h-36 text-base"
          />
        )}
      </CardContent>
    </Card>
  )
}

function answerText(question: QuizQuestion, answer?: Answer): string {
  if (answer === undefined || answer === '' || (Array.isArray(answer) && !answer.length)) return 'Ответ не дан'
  if (Array.isArray(answer)) {
    return answer.map((id) => question.options?.find((option) => option.id === id)?.label ?? id).join(', ')
  }
  return question.options?.find((option) => option.id === answer)?.label ?? answer
}

/**
 * Показывает разбор отдельного вопроса после отправки теста.
 * @see ../docs/product/quizzes.md#quiz-results
 */
function ResultCard({ result, index }: { result: QuestionResult; index: number }) {
  const wrong = result.points === 0
  const pending = result.points === null
  const partial = !pending && !wrong && result.points !== result.question.points
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={pending || partial ? 'secondary' : wrong ? 'destructive' : 'default'}>
            {pending ? 'Ждёт проверки' : wrong ? 'Неверно' : partial ? 'Частично верно' : 'Верно'}
          </Badge>
          <span className="text-sm text-muted-foreground">{pending ? '—' : result.points} / {result.question.points}</span>
        </div>
        <CardTitle className="text-lg leading-snug">{index + 1}. {result.question.prompt}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm sm:text-base">
        {result.question.code && <CodeBlock code={result.question.code} />}
        <div className="result-answers">
          <p className={wrong ? 'result-answer-wrong' : ''}><span>Ваш ответ</span><strong>{answerText(result.question, result.answer)}</strong></p>
          {!pending && wrong && result.correctAnswer !== undefined && (
            <p className="result-answer-correct"><span>Правильный ответ</span><strong>{answerText(result.question, result.correctAnswer)}</strong></p>
          )}
        </div>
        {pending && <p className="text-muted-foreground">Разбор появится здесь после проверки.</p>}
        {result.learning ? (
          <section className="result-learning" aria-label="Разбор и материал">
            <div className="result-rule">
              <h3>Правило</h3>
              <p>{result.learning.rule}</p>
            </div>
            <div className="result-why">
              <h3>Почему здесь так</h3>
              <p>{result.learning.why}</p>
            </div>
            <div className="result-material">
              <BookOpen className="size-5 shrink-0" aria-hidden="true" />
              <div>
                <h3>{result.learning.sourceHeading ?? 'Где читать в учебнике'}</h3>
                <p>{result.learning.textbook}</p>
                <p>{result.learning.nextStep}</p>
                {result.learning.textbookUrl?.startsWith('https://') && <a href={result.learning.textbookUrl} target="_blank" rel="noopener noreferrer">Страница учебника у издателя <ExternalLink className="inline size-4" aria-hidden="true" /></a>}
                {result.learning.url?.startsWith('https://') && <a href={result.learning.url} target="_blank" rel="noopener noreferrer">{result.learning.urlLabel ?? 'Открыть материал'} <ExternalLink className="inline size-4" aria-hidden="true" /></a>}
              </div>
            </div>
          </section>
        ) : (result.explanation || result.source) && (
          <section className="result-learning" aria-label="Разбор и материал">
            {result.explanation && <div className="result-rule"><h3>Объяснение</h3><p>{result.explanation}</p></div>}
            {result.source && <div className="result-material"><BookOpen className="size-5 shrink-0" aria-hidden="true" /><div><h3>Где читать</h3><p>{result.source}</p></div></div>}
          </section>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Собирает результат из ответов, ключа и доступной ручной проверки.
 * @see ../docs/product/quizzes.md#quiz-results
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
  const percentage = summary.possible ? Math.round(100 * summary.earned / summary.possible) : 0

  return (
    <div className="space-y-6">
      {summary.pending === 0 && percentage === 100 && <div className="celebration" aria-hidden="true">✦ ✳ ✦ ✴ ✳ ✦</div>}
      <Card className="result-hero border-0 shadow-lg">
        <CardContent className="space-y-5 py-8 sm:py-10">
          <Badge className="bg-white/20 text-white"><Sparkles className="size-3" /> Работа отправлена</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{summary.pending ? 'Хорошее начало!' : 'Готово!'}</h1>
          <p className="max-w-2xl text-white/85">{assignment.title}</p>
          <div className="score-panel">
            <strong className="text-4xl sm:text-5xl">{summary.earned}<span className="text-2xl font-normal text-white/70"> / {summary.possible}</span></strong>
            <span>{summary.pending ? `Ещё ${summary.pending} ${wordForm(summary.pending, 'ответ ждёт', 'ответа ждут', 'ответов ждут')} проверки` : `${percentage}% правильных баллов`}</span>
          </div>
          <Progress value={percentage} className="bg-white/20" />
          {summary.pending > 0 && <p className="text-sm text-white/80">Итог предварительный. Полный разбор появится по этой же ссылке после проверки.</p>}
        </CardContent>
      </Card>
      <h2 className="text-xl font-semibold sm:text-2xl">Разбор по вопросам</h2>
      <div className="space-y-4">{results.map((result, index) => <ResultCard key={result.question.id} result={result} index={index} />)}</div>
    </div>
  )
}

/**
 * Ведёт попытку, последовательное сохранение ответов и отправку теста.
 * @see ../docs/product/quizzes.md#quiz-runner
 * @see ../docs/product/day-page.md#test-progress
 */
function QuizRunner({ token }: { token: string }) {
  const [assignment, setAssignment] = useState<Assignment>()
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const answersRef = useRef<Record<string, Answer>>({})
  const serverAnswersRef = useRef<Record<string, Answer>>({})
  const dirtyAnswers = useRef<Record<string, { value: Answer; revision: number }>>({})
  const answerRevision = useRef(0)
  const writeQueue = useRef(new WriteQueue())
  const pendingWrites = useRef(0)

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void watchAssignment(token, (data) => {
      if (!active) return
      setAssignment(data)
      serverAnswersRef.current = data.answers ?? {}
      if (data.status === 'submitted' || pendingWrites.current === 0 && Object.keys(dirtyAnswers.current).length === 0) {
        answersRef.current = serverAnswersRef.current
        setAnswers(answersRef.current)
      }
    }, (cause) => { if (active) setError(describeError(cause)) }).then((next) => {
      if (active) unsubscribe = next
      else next()
    }).catch((cause) => { if (active) setError(describeError(cause)) })
    return () => { active = false; unsubscribe?.() }
  }, [token])

  function queueSave() {
    setError('')
    setSaving(true)
    pendingWrites.current += 1
    const write = writeQueue.current.add(async () => {
      const pending = { ...dirtyAnswers.current }
      const patch = Object.fromEntries(Object.entries(pending).map(([id, change]) => [id, change.value]))
      if (Object.keys(patch).length === 0) return
      await saveDraft(token, patch)
      serverAnswersRef.current = { ...serverAnswersRef.current, ...patch }
      for (const [id, change] of Object.entries(pending)) {
        if (dirtyAnswers.current[id]?.revision === change.revision) delete dirtyAnswers.current[id]
      }
      setUnsaved(Object.keys(dirtyAnswers.current).length > 0)
      setError('')
    })
    void write.catch((cause) => setError(`Не удалось сохранить ответ: ${describeError(cause)}`)).finally(() => {
      pendingWrites.current -= 1
      if (pendingWrites.current === 0) {
        setSaving(false)
        if (Object.keys(dirtyAnswers.current).length === 0) {
          answersRef.current = serverAnswersRef.current
          setAnswers(answersRef.current)
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
    queueSave()
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
      <div className="space-y-5">{assignment.questions.map((question, index) => (
        <QuestionCard key={question.id} question={question} index={index} answer={answers[question.id]} onAnswer={(value) => updateAnswer(question.id, value)} />
      ))}</div>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="flex flex-col items-start justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{error ? 'Сохранение не подтверждено' : saving ? 'Сохраняем ответ в Firebase…' : unsaved ? 'Ответы ещё не сохранены' : 'Все выбранные ответы сохранены'}</span>
          {unsaved && !saving && <Button variant="outline" onClick={queueSave}>Повторить сохранение</Button>}
        </div>
        <Button size="lg" disabled={submitting || saving || unsaved} onClick={submit}><Send /> {submitting ? 'Отправляем…' : 'Завершить тест'}</Button>
      </div>
      </div>
    </ThemeFrame>
  )
}

/**
 * Показывает вопросы родителю без записи ответов и создания попытки.
 * @see ../docs/product/quizzes.md#test-lists
 */
function Preview({ token }: { token: string }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof loadPreview>>>()
  const [error, setError] = useState('')
  useEffect(() => { loadPreview(token).then(setPreview).catch((cause) => setError(describeError(cause))) }, [token])
  if (error) return <ErrorCard message={error} />
  if (!preview) return <p>Загружаем предпросмотр…</p>
  return (
    <ThemeFrame subject={preview.subject} visual={preview.visual}>
      <div className="space-y-6">
      <ThemeHero subject={preview.subject} visual={preview.visual} title={preview.title} description={preview.description} preview />
      <ReadingCard reading={preview.reading} />
      {preview.questions.map((question, index) => <QuestionCard key={question.id} question={question} index={index} disabled onAnswer={() => {}} />)}
      </div>
    </ThemeFrame>
  )
}

/** Parent links and direct student URLs share a read-only result surface. The
 * actual permission to write is enforced by Firestore assignment ownership.
 * @see ../docs/product/quizzes.md#parent-read-only
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
        if (active) setStudent(Boolean(profile?.children.some((child) => child.role === 'student')))
      } catch (cause) { if (active) setError(describeError(cause)) }
    })()
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (student !== false) return
    let active = true
    let stop: (() => void) | undefined
    void watchAssignment(token, (value) => { if (active) setAssignment(value) }, (cause) => { if (active) setError(describeError(cause)) }).then((unsubscribe) => { if (active) stop = unsubscribe; else unsubscribe() })
    return () => { active = false; stop?.() }
  }, [student, token])
  if (error) return <ErrorCard message={error} />
  if (student === null) return <p>Проверяем профиль…</p>
  if (student) return <QuizRunner token={token} />
  if (!assignment) return <p>Загружаем тест для просмотра…</p>
  if (assignment.status === 'submitted') return <ThemeFrame subject={assignment.subject} visual={assignment.visual}><ResultView assignment={assignment} token={token} /></ThemeFrame>
  return <ThemeFrame subject={assignment.subject} visual={assignment.visual}><div className="space-y-6">
    <ThemeHero subject={assignment.subject} visual={assignment.visual} title={assignment.title} description={assignment.description} preview />
    <ReadingCard reading={assignment.reading} />
    <p className="text-sm text-muted-foreground">Только просмотр: ответы ученика здесь изменить нельзя.</p>
    {assignment.questions.map((question, index) => <QuestionCard key={question.id} question={question} index={index} disabled onAnswer={() => {}} />)}
  </div></ThemeFrame>
}

type BoardItem = {
  token: string
  title: string
  description: string
  board: BoardDetails | null
  subject: string
  slug: string
  previewToken: string
  position: number | null
  createdAt: { seconds?: number } | null
  status: Assignment['status']
  answered: number
  total: number
  submittedAt: { seconds?: number } | null
}

/**
 * Карточка назначения в ученическом или родительском списке тестов.
 * @see ../docs/product/quizzes.md#test-lists
 */
function BoardCard({ item, parent = false, unread = false, copied = false, onCopy, onMarkViewed }: {
  item: BoardItem
  parent?: boolean
  unread?: boolean
  copied?: boolean
  onCopy?: (item: BoardItem) => void
  onMarkViewed?: (token: string) => void
}) {
  const completed = item.status === 'submitted'
  const remaining = Math.max(0, item.total - item.answered)
  return (
    <Card className="board-card border-0 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={completed && !unread ? 'secondary' : 'default'}>{parent && completed ? unread ? 'Новый результат' : 'Просмотрен' : completed ? 'Пройден' : item.answered ? 'В процессе' : 'Не начат'}</Badge>
          <span className="text-sm text-muted-foreground">{item.answered} из {item.total}</span>
        </div>
        {parent && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.subject}</span>}
        <CardTitle className="text-xl font-semibold">{item.title}</CardTitle>
        {item.description && <details className="board-description">
          <summary><span>{item.description}</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" /></summary>
          {item.board && <div className="board-description-content">
            <div><h4>На основе материалов</h4><ul>{item.board.materials.map((material) => <li key={material}>{material}</li>)}</ul></div>
            <div><h4>Что повторить</h4><p>{item.board.review}</p></div>
            <div><h4>Зачем этот тест</h4><p>{item.board.purpose}</p></div>
          </div>}
        </details>}
      </CardHeader>
      <CardContent className="space-y-4">
        {!completed && <div className="space-y-2"><div className="flex justify-between gap-2 text-sm"><span>Отвечено: {item.answered}</span><strong>Осталось: {remaining}</strong></div><Progress value={item.total ? item.answered * 100 / item.total : 0} /></div>}
        <div className="flex flex-wrap gap-2">
          {!parent && <Button asChild><a href={`#/t/${item.slug}~${item.token}`}>{completed ? 'Посмотреть результат' : item.answered ? 'Продолжить тест' : 'Начать тест'}</a></Button>}
          {parent && completed && <Button asChild><a href={`#/t/${item.slug}~${item.token}`} onClick={() => { if (unread) onMarkViewed?.(item.token) }}>Посмотреть результат</a></Button>}
          {item.previewToken && <Button variant="outline" asChild><a href={`#/preview/${item.slug}~${item.previewToken}`}>{parent ? 'Посмотреть вопросы' : 'Просмотреть без ответов'}</a></Button>}
          {parent && completed && <Button variant="outline" onClick={() => onCopy?.(item)}><ClipboardCopy /> {copied ? 'Скопировано' : 'Скопировать задание агенту'}</Button>}
          {parent && unread && <Button variant="ghost" onClick={() => onMarkViewed?.(item.token)}>Отметить просмотренным</Button>}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Живой список назначений и результатов для соответствующей ссылки.
 * @see ../docs/product/quizzes.md#test-lists
 */
function Dashboard({ token, parent = false }: { token: string; parent?: boolean }) {
  const [items, setItems] = useState<BoardItem[]>()
  const [seen, setSeen] = useState<Set<string> | undefined>(parent ? undefined : new Set())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let active = true
    let generation = 0
    let stopIndex: (() => void) | undefined
    let stopAssignments: Array<() => void> = []
    void watchDashboard(token, (index) => {
      generation += 1
      const currentGeneration = generation
      stopAssignments.forEach((stop) => stop())
      stopAssignments = []
      const rows = new Map<string, BoardItem>()
      if (index.length === 0) setItems([])
      for (const item of index) {
        void watchAssignment(item.token, (assignment) => {
          if (!active || currentGeneration !== generation) return
          rows.set(item.token, {
            ...item,
            title: item.title || assignment.title,
            description: item.description || assignment.description || '',
            board: item.board,
            subject: item.subject || assignment.subject,
            status: assignment.status,
            answered: countAnswered(assignment),
            total: assignment.questions.length,
            submittedAt: assignment.submittedAt as { seconds?: number } | null,
          })
          if (rows.size === index.length) {
            const next = [...rows.values()].sort((a, b) => (a.position ?? a.createdAt?.seconds ?? 0) - (b.position ?? b.createdAt?.seconds ?? 0))
            setItems(next)
            setError('')
          }
        }, (cause) => { if (active) setError(describeError(cause)) }).then((stop) => {
          if (active && currentGeneration === generation) stopAssignments.push(stop)
          else stop()
        }).catch((cause) => { if (active) setError(describeError(cause)) })
      }
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
      stopAssignments.forEach((stop) => stop())
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
      {parent && newResults.length > 0 && <section className="space-y-3" aria-label="Новые результаты"><h2 className="board-subject-title">Новые результаты</h2>{newResults.map((item) => <BoardCard key={item.token} item={item} parent unread copied={copied === item.token} onCopy={copyPrompt} onMarkViewed={markResultViewed} />)}</section>}
      {subjects.map((subject) => {
        const subjectItems = items?.filter((item) => item.subject === subject) ?? []
        const active = subjectItems.filter((item) => item.status !== 'submitted')
        const archived = subjectItems.filter((item) => item.status === 'submitted')
        const reviewed = seenResults.filter((item) => item.subject === subject)
        if (parent && active.length === 0 && reviewed.length === 0) return null
        return <section key={subject} className="space-y-4" aria-label={subject}>
          <h2 className="board-subject-title">{subject}</h2>
          {active.length > 0 && <div className="space-y-3"><h3 className="board-section-title">{parent ? 'В работе' : 'Активные'}</h3>{active.map((item) => <BoardCard key={item.token} item={item} parent={parent} />)}</div>}
          {(parent ? reviewed : archived).length > 0 && <div className="space-y-3"><h3 className="board-section-title">{parent ? 'Просмотренные результаты' : 'Пройденные · архив'}</h3>{(parent ? reviewed : archived).map((item) => <BoardCard key={item.token} item={item} parent={parent} copied={copied === item.token} onCopy={copyPrompt} onMarkViewed={markResultViewed} />)}</div>}
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
 * @see ../docs/product/access-and-state.md#routes
 */
function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
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
      setRoute(nextRoute)
    }
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])
  return <Shell dayRoute={route.kind === 'day' || route.kind === 'day-parent'} quizBack={route.kind === 'test' || route.kind === 'preview' ? testReturn : undefined} onHeaderTarget={setHeaderReturnTarget}>{route.kind === 'test' ? <QuizAccess key={route.token} token={route.token} /> : route.kind === 'preview' ? <Preview token={route.token} /> : route.kind === 'dashboard' || route.kind === 'my' || route.kind === 'review' ? <Dashboard key={`${route.kind}-${route.token}`} token={route.token} parent={route.kind === 'review'} /> : route.kind === 'days' || route.kind === 'days-parent' ? <DayDashboard key={`${route.kind}-${route.token}`} token={route.token} parent={route.kind === 'days-parent'} /> : route.kind === 'day' || route.kind === 'day-parent' ? <DayPage key={`${route.kind}-${route.token}`} token={route.token} parent={route.kind === 'day-parent'} headerReturnTarget={headerReturnTarget} /> : route.kind === 'enter' ? <PersonalEntry key={route.token} initialLink={route.token} /> : <Home />}</Shell>
}

export default App
