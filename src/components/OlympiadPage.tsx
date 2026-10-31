import { useEffect, useState, type ReactNode } from 'react'
import DayPage from '../DayPage'
import OlympiadReferences from './OlympiadReferences'
import OlympiadSchedule from './OlympiadSchedule'
import { traceOlympiad, traceAccess, accessTraceError } from '@/lib/browserAccessTrace'
import { watchFamilyOlympiadTasks, watchPublicOlympiads, watchOlympiadSelections, type FamilyOlympiadTask, type PublicOlympiad } from '@/lib/educationStore'
import { watchDayDashboard, type DayDashboardData } from '@/lib/dayDashboardStore'
import '../DayDashboard.css'

/** Olympiad preparation is a view over the same family task and day page.
 * @see ../../docs/modules/assessments/olympiad-preparation.md */
export default function OlympiadPage({ familyId, childId, olympiadId, parent, dashboardToken, canonicalToken = dashboardToken,
  watchTasks = watchFamilyOlympiadTasks, watchDashboard = watchDayDashboard, watchCatalog = watchPublicOlympiads, watchSelections = watchOlympiadSelections, renderPractice, diagnosticsContext = 'product' }: {
  familyId: string; childId: string; olympiadId: string; parent: boolean; dashboardToken: string; canonicalToken?: string
  watchTasks?: typeof watchFamilyOlympiadTasks; watchDashboard?: typeof watchDayDashboard; watchCatalog?: typeof watchPublicOlympiads; watchSelections?: typeof watchOlympiadSelections
  renderPractice?: (task: FamilyOlympiadTask, dayToken: string, parent: boolean, quizTarget: HTMLElement | null, number: number) => ReactNode
  diagnosticsContext?: 'demo' | 'product'
}) {
  const [tasks, setTasks] = useState<FamilyOlympiadTask[]>()
  const [selections, setSelections] = useState<string[]>()
  const [catalog, setCatalog] = useState<PublicOlympiad[]>()
  const [dashboard, setDashboard] = useState<DayDashboardData>()
  const [error, setError] = useState('')
  const [quizTarget, setQuizTarget] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setTasks(undefined); setDashboard(undefined); setCatalog(undefined); setSelections(undefined); setError('')
    const fail = (cause: Error) => { traceAccess('access.failed', { atFunction: 'OlympiadPage#load', previousState: 'checking', state: 'failed', source: 'route', code: accessTraceError(cause) }); setTasks(undefined); setDashboard(undefined); setError('Не удалось открыть подготовку.'); traceOlympiad('page-failed', diagnosticsContext, parent ? 'parent' : 'student') }
    const stopSelection = parent ? () => {} : watchSelections(familyId, childId, setSelections, fail)
    const stopCatalog = watchCatalog(setCatalog, fail)
    const stopTasks = watchTasks(familyId, childId, setTasks, fail)
    const stopDashboard = watchDashboard(dashboardToken, setDashboard, fail)
    return () => { stopTasks(); stopDashboard(); stopCatalog(); stopSelection() }
  }, [familyId, childId, dashboardToken, parent, watchTasks, watchDashboard, watchCatalog, watchSelections, diagnosticsContext])
  const olympiad = catalog?.find(item => item.id === olympiadId)
  const matching = tasks?.filter(task => task.learningContext.id === olympiadId) ?? []
  const sourcePhotoIds = [...new Set(matching.flatMap(task => task.sourcePhotoIds ?? []))]
  const prepared = matching.filter(task => !task.sourceIntake && !task.sourcePhotoIds?.length)
  const uploaded = matching.filter(task => !task.sourceIntake && !!task.sourcePhotoIds?.length)
  const intake = matching.filter(task => task.sourceIntake)
  const projectionReady = dashboard?.kind === (parent ? 'parent' : 'student')
  useEffect(() => {
    if (tasks && projectionReady) traceOlympiad('page-loaded', diagnosticsContext, parent ? 'parent' : 'student', tasks.filter(item => item.learningContext.id === olympiadId).reduce((sum, item) => sum + item.testTokens.length, 0))
  }, [tasks, projectionReady, olympiadId, parent, diagnosticsContext])
  function renderTask(task: FamilyOlympiadTask, number: number) {
    const dayToken = projectionReady ? dashboard?.days.find(day => day.date === task.projectionSourceDate)?.dayToken : null
    return !dayToken ? <p key={task.id} role="alert">«{task.title}»: страница подготовки ещё не опубликована.</p> : <div key={task.id}>{renderPractice ? renderPractice(task, dayToken, parent, quizTarget, number) : <DayPage key={`${familyId}/${childId}/${dayToken}/${task.id}`} token={dayToken} parent={parent} headerReturnTarget={null} olympiadScope={{ familyId, childId, olympiadId, taskId: task.id, testTokens: task.testTokens, number, quizTarget, sourcePhotoIds }} />}</div>
  }
  return <section className="day-dashboard-card" aria-label="Подготовка к олимпиаде"><a href={`#/days/${encodeURIComponent(canonicalToken)}`}>← На главную</a>
    {error ? <p role="alert">{error}</p> : !tasks || !dashboard || !catalog || (!parent && !selections) ? <p role="status">Открываем олимпиаду…</p> : !parent && !selections?.includes(olympiadId) ? <p role="alert">Эту олимпиаду ещё не включил родитель.</p> : !olympiad ? <p role="alert">Сведения об олимпиаде недоступны.</p> : <>
      <h1>{olympiad.title}</h1>{olympiad.subject && <p>{olympiad.subject}</p>}{olympiad.schedule && !olympiad.calendar?.statusLabel && <p>{olympiad.schedule}</p>}
      <p>Подготовка — дополнительная работа. Текущие конкурсные задачи выполняются по правилам организатора.</p>
      <OlympiadSchedule calendar={olympiad.calendar} />
      <OlympiadReferences olympiadId={olympiadId} parent={parent} context={diagnosticsContext} />
      {matching.some(task => task.testTokens.length > 0) && <section className="olympiad-section" aria-labelledby="olympiad-methods-title"><h2 id="olympiad-methods-title">Приёмы и тесты</h2><div className="olympiad-quiz-list" ref={setQuizTarget} /></section>}
      <section className="olympiad-section" aria-labelledby="olympiad-practice-title"><h2 id="olympiad-practice-title">Практика</h2>{prepared.length + uploaded.length ? <p>Задач: {prepared.length + uploaded.length}. Можно начинать с любой.</p> : <p>Задачи для практики пока не опубликованы.</p>}
        {prepared.length > 0 && <section className="olympiad-practice-group" aria-labelledby="olympiad-prepared-title"><h3 id="olympiad-prepared-title">Задачи для подготовки · {prepared.length}</h3><div className="olympiad-practice-list">{prepared.map((task, index) => renderTask(task, index + 1))}</div></section>}
        {(uploaded.length > 0 || intake.length > 0) && <section className="olympiad-practice-group" aria-labelledby="olympiad-uploaded-title"><h3 id="olympiad-uploaded-title">Загруженные задачи · {uploaded.length}</h3><p>Задачи из ваших фотографий.</p><div className="olympiad-practice-list">{uploaded.map((task, index) => renderTask(task, task.competitionNumber ?? index + 1))}{intake.map(task => renderTask(task, 0))}</div></section>}
      </section>
    </>}
  </section>
}
