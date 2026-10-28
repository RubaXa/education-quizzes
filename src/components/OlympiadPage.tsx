import { useEffect, useState, type ReactNode } from 'react'
import DayPage from '../DayPage'
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
  renderPractice?: (task: FamilyOlympiadTask, dayToken: string, parent: boolean) => ReactNode
  diagnosticsContext?: 'demo' | 'product'
}) {
  const [tasks, setTasks] = useState<FamilyOlympiadTask[]>()
  const [selections, setSelections] = useState<string[]>()
  const [catalog, setCatalog] = useState<PublicOlympiad[]>()
  const [dashboard, setDashboard] = useState<DayDashboardData>()
  const [error, setError] = useState('')
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
  const task = matching[0]
  const dayToken = task && dashboard?.kind === (parent ? 'parent' : 'student') ? dashboard.days.find(day => day.date === task.projectionSourceDate)?.dayToken : null
  useEffect(() => {
    if (task && dayToken) traceOlympiad('page-loaded', diagnosticsContext, parent ? 'parent' : 'student', task.testTokens.length)
  }, [task?.id, dayToken, parent, diagnosticsContext])
  return <section className="day-dashboard-card" aria-label="Подготовка к олимпиаде"><a href={`#/days/${encodeURIComponent(canonicalToken)}`}>← На главную</a>
    {error ? <p role="alert">{error}</p> : !tasks || !dashboard || !catalog || (!parent && !selections) ? <p role="status">Открываем олимпиаду…</p> : !parent && !selections?.includes(olympiadId) ? <p role="alert">Эту олимпиаду ещё не включил родитель.</p> : !olympiad ? <p role="alert">Сведения об олимпиаде недоступны.</p> : <>
      <h1>{olympiad.title}</h1>{olympiad.subject && <p>{olympiad.subject}</p>}{olympiad.schedule && <p>{olympiad.schedule}</p>}
      <p>Подготовка — дополнительная работа. Текущие конкурсные задачи выполняются по правилам организатора.</p>
      {!task ? <p>Материалы подготовки пока не опубликованы.</p> : !dayToken ? <p role="alert">Страница подготовки ещё не опубликована.</p> : renderPractice ? renderPractice(task, dayToken, parent) : <DayPage key={`${familyId}/${childId}/${dayToken}/${task.id}`} token={dayToken} parent={parent} headerReturnTarget={null} olympiadScope={{ familyId, childId, olympiadId, taskId: task.id, testTokens: task.testTokens }} />}
    </>}
  </section>
}
