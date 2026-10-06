import { useEffect, useRef, useState } from 'react'
import { BookOpen, CheckCircle2, CircleHelp, Clock3, RefreshCw, Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { grade, summarize } from '@/lib/quiz'
import type { Answer, AnswerKey, Assignment, ManualReview, QuizQuestion, QuestionResult } from '@/lib/quiz'
import './App.css'

type Route = { kind: 'test' | 'preview' | 'dashboard'; token: string } | { kind: 'home' }

const storeModule = () => import('@/lib/store')
const loadAssignment = async (token: string) => (await storeModule()).loadAssignment(token)
const loadAnswerKey = async (token: string) => (await storeModule()).loadAnswerKey(token)
const loadReview = async (token: string) => (await storeModule()).loadReview(token)
const loadPreview = async (token: string) => (await storeModule()).loadPreview(token)
const loadDashboard = async (token: string) => (await storeModule()).loadDashboard(token)
const saveDraft = async (token: string, answers: Record<string, Answer>) => (await storeModule()).saveDraft(token, answers)
const submitAssignment = async (token: string, answers: Record<string, Answer>) => (await storeModule()).submitAssignment(token, answers)

function routeFromHash(): Route {
  const [, kind, raw = ''] = location.hash.split('/')
  const token = raw.includes('~') ? raw.slice(raw.lastIndexOf('~') + 1) : raw
  if ((kind === 't' || kind === 'preview' || kind === 'dashboard') && token) {
    return { kind: kind === 't' ? 'test' : kind, token }
  }
  return { kind: 'home' }
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand"><span className="brand-mark">✳</span><span>Учусь и проверяю</span></div>
        <span className="header-note">Маленькие шаги. Большой прогресс.</span>
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
        {question.code && <pre className="question-code"><code>{question.code}</code></pre>}
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

function ResultCard({ result, index }: { result: QuestionResult; index: number }) {
  const wrong = result.points === 0
  const pending = result.points === null
  const partial = !pending && !wrong && result.points !== result.question.points
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={pending || partial ? 'secondary' : wrong ? 'destructive' : 'default'}>
            {pending ? 'Ждёт проверки' : wrong ? 'Стоит повторить' : partial ? 'Частично верно' : 'Верно'}
          </Badge>
          <span className="text-sm text-muted-foreground">{pending ? '—' : result.points} / {result.question.points}</span>
        </div>
        <CardTitle className="text-lg leading-snug">{index + 1}. {result.question.prompt}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm sm:text-base">
        {result.question.code && <pre className="question-code"><code>{result.question.code}</code></pre>}
        <p><span className="font-medium">Ваш ответ:</span> {answerText(result.question, result.answer)}</p>
        {!pending && wrong && result.correctAnswer !== undefined && (
          <p><span className="font-medium">Верный ответ:</span> {answerText(result.question, result.correctAnswer)}</p>
        )}
        {pending && <p className="text-muted-foreground">Разбор появится здесь после проверки.</p>}
        {result.explanation && <p className="rounded-xl bg-muted p-3">{result.explanation}</p>}
        {result.source && <p className="flex items-start gap-2 text-muted-foreground"><BookOpen className="mt-0.5 size-4 shrink-0" /> {result.source}</p>}
      </CardContent>
    </Card>
  )
}

function ResultView({ assignment, token }: { assignment: Assignment; token: string }) {
  const [key, setKey] = useState<AnswerKey>()
  const [review, setReview] = useState<ManualReview>()
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    setRefreshing(true)
    try {
      const [nextKey, nextReview] = await Promise.all([loadAnswerKey(token), loadReview(token)])
      setKey(nextKey)
      setReview(nextReview)
      setError('')
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { void refresh() }, [token])

  if (!key) return <ErrorCard message={error || 'Загружаем результат…'} onRetry={refresh} />
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
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold sm:text-2xl">Разбор по вопросам</h2>
        <Button variant="outline" disabled={refreshing} onClick={refresh}><RefreshCw className={refreshing ? 'animate-spin' : ''} /> Обновить</Button>
      </div>
      <div className="space-y-4">{results.map((result, index) => <ResultCard key={result.question.id} result={result} index={index} />)}</div>
    </div>
  )
}

function QuizRunner({ token }: { token: string }) {
  const [assignment, setAssignment] = useState<Assignment>()
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    loadAssignment(token).then((data) => {
      if (active) { setAssignment(data); setAnswers(data.answers ?? {}) }
    }).catch((cause) => { if (active) setError(describeError(cause)) })
    return () => { active = false; if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [token])

  function updateAnswer(questionId: string, value: Answer) {
    const next = { ...answers, [questionId]: value }
    setAnswers(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setSaving(true)
      saveDraft(token, next)
        .catch((cause) => setError(`Не удалось сохранить черновик: ${describeError(cause)}`))
        .finally(() => setSaving(false))
    }, 700)
  }

  async function submit() {
    if (!assignment || !window.confirm('Отправить работу? После этого ответы нельзя будет изменить.')) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSubmitting(true)
    try {
      await submitAssignment(token, answers)
      setAssignment(await loadAssignment(token))
      setError('')
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !assignment) return <ErrorCard message={error} />
  if (!assignment) return <Card className="mx-auto max-w-xl"><CardContent className="py-10 text-center">Загружаем тест…</CardContent></Card>
  if (assignment.status === 'submitted') return <ResultView assignment={assignment} token={token} />

  const answered = assignment.questions.filter((question) => {
    const answer = answers[question.id]
    return typeof answer === 'string' ? answer.trim().length > 0 : Array.isArray(answer) && answer.length > 0
  }).length
  const progress = assignment.questions.length ? Math.round(100 * answered / assignment.questions.length) : 0

  return (
    <div className="space-y-6">
      <div className="intro-card">
        <Badge variant="secondary" className="bg-white/80">{assignment.subject}</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{assignment.title}</h1>
        {assignment.description && <p className="max-w-2xl text-muted-foreground">{assignment.description}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><CircleHelp className="size-4" /> {assignment.questions.length} {wordForm(assignment.questions.length, 'вопрос', 'вопроса', 'вопросов')}</span>
          <span className="flex items-center gap-2"><Clock3 className="size-4" /> Можно продолжить позже по этой ссылке</span>
        </div>
      </div>
      <div className="sticky-progress rounded-2xl bg-white/95 px-5 py-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex justify-between text-sm"><span>Ваш прогресс</span><strong>{answered} из {assignment.questions.length}</strong></div>
        <Progress value={progress} />
      </div>
      <div className="space-y-5">{assignment.questions.map((question, index) => (
        <QuestionCard key={question.id} question={question} index={index} answer={answers[question.id]} onAnswer={(value) => updateAnswer(question.id, value)} />
      ))}</div>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="flex flex-col items-start justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <span className="text-sm text-muted-foreground">{saving ? 'Сохраняем ответы…' : 'Ответы сохраняются автоматически'}</span>
        <Button size="lg" disabled={submitting} onClick={submit}><Send /> {submitting ? 'Отправляем…' : 'Завершить тест'}</Button>
      </div>
    </div>
  )
}

function Preview({ token }: { token: string }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof loadPreview>>>()
  const [error, setError] = useState('')
  useEffect(() => { loadPreview(token).then(setPreview).catch((cause) => setError(describeError(cause))) }, [token])
  if (error) return <ErrorCard message={error} />
  if (!preview) return <p>Загружаем предпросмотр…</p>
  return (
    <div className="space-y-6">
      <div className="intro-card">
        <Badge variant="secondary" className="bg-white/80">Предпросмотр · только чтение</Badge>
        <h1 className="text-3xl font-bold sm:text-5xl">{preview.title}</h1>
        {preview.description && <p className="text-muted-foreground">{preview.description}</p>}
      </div>
      {preview.questions.map((question, index) => <QuestionCard key={question.id} question={question} index={index} disabled onAnswer={() => {}} />)}
    </div>
  )
}

function Dashboard({ token }: { token: string }) {
  const [items, setItems] = useState<Array<{ token: string; title: string; subject: string; slug: string; previewToken: string; status: string }>>()
  const [error, setError] = useState('')
  useEffect(() => {
    loadDashboard(token).then(async (index) => {
      const rows = await Promise.all(index.map(async (item) => ({
        ...item,
        status: (await loadAssignment(item.token)).status,
      })))
      setItems(rows)
    }).catch((cause) => setError(describeError(cause)))
  }, [token])
  if (error) return <ErrorCard message={error} />
  return (
    <div className="space-y-6">
      <div className="intro-card">
        <Badge variant="secondary" className="bg-white/80">Кабинет взрослого</Badge>
        <h1 className="text-3xl font-bold sm:text-5xl">Все самопроверки</h1>
        <p className="text-muted-foreground">Эта ссылка даёт доступ к истории. Храните её только у себя.</p>
      </div>
      {!items && <p>Загружаем список…</p>}
      {items?.length === 0 && <Card><CardContent className="py-10 text-center">Тестов пока нет.</CardContent></Card>}
      <div className="grid gap-4 sm:grid-cols-2">{items?.map((item) => (
        <Card key={item.token} className="border-0 shadow-sm">
          <CardHeader>
            <div className="flex justify-between gap-2"><Badge variant="secondary">{item.subject}</Badge><span className="text-sm text-muted-foreground">{item.status === 'submitted' ? 'Отправлен' : 'Ожидает'}</span></div>
            <CardTitle>{item.title}</CardTitle>
          </CardHeader>
          <CardContent><Button variant="outline" asChild><a href={item.status === 'submitted' ? `#/t/${item.slug}~${item.token}` : `#/preview/${item.slug}~${item.previewToken}`}>{item.status === 'submitted' ? 'Открыть результат' : 'Предпросмотр'}</a></Button></CardContent>
        </Card>
      ))}</div>
    </div>
  )
}

function Home() {
  return (
    <Card className="mx-auto max-w-2xl border-0 shadow-sm">
      <CardContent className="flex flex-col items-center gap-5 py-14 text-center">
        <div className="home-icon"><CheckCircle2 className="size-10" /></div>
        <h1 className="text-3xl font-bold sm:text-4xl">Здесь начинаются маленькие победы</h1>
        <p className="max-w-lg text-muted-foreground">Чтобы открыть самопроверку, перейдите по личной ссылке, которую вам прислали.</p>
      </CardContent>
    </Card>
  )
}

function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  useEffect(() => {
    const updateRoute = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])
  return <Shell>{route.kind === 'test' ? <QuizRunner token={route.token} /> : route.kind === 'preview' ? <Preview token={route.token} /> : route.kind === 'dashboard' ? <Dashboard token={route.token} /> : <Home />}</Shell>
}

export default App
