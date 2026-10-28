import { useEffect, useState, type ReactNode } from 'react'
import DayPage from '../DayPage'
import { traceOlympiad } from '@/lib/browserAccessTrace'
import { watchFamilyOlympiadTasks, type FamilyOlympiadTask } from '@/lib/educationStore'
import { watchDayDashboard, type DayDashboardData } from '@/lib/dayDashboardStore'
import '../DayDashboard.css'

/** Olympiad preparation is a view over the same family task and day page.
 * @see ../../docs/modules/assessments/olympiad-preparation.md */
export default function OlympiadPage({ familyId, childId, olympiadId, parent, dashboardToken,
  watchTasks = watchFamilyOlympiadTasks, watchDashboard = watchDayDashboard, renderPractice, diagnosticsContext = 'product' }: {
  familyId: string; childId: string; olympiadId: string; parent: boolean; dashboardToken: string
  watchTasks?: typeof watchFamilyOlympiadTasks; watchDashboard?: typeof watchDayDashboard
  renderPractice?: (task: FamilyOlympiadTask, dayToken: string, parent: boolean) => ReactNode
  diagnosticsContext?: 'demo' | 'product'
}) {
  const [tasks, setTasks] = useState<FamilyOlympiadTask[]>()
  const [dashboard, setDashboard] = useState<DayDashboardData>()
  const [error, setError] = useState('')
  useEffect(() => {
    setTasks(undefined); setDashboard(undefined); setError('')
    const fail = () => { setTasks(undefined); setDashboard(undefined); setError('Не удалось открыть подготовку.'); traceOlympiad('page-failed', diagnosticsContext, parent ? 'parent' : 'student') }
    const stopTasks = watchTasks(familyId, childId, setTasks, fail)
    const stopDashboard = watchDashboard(dashboardToken, setDashboard, fail)
    return () => { stopTasks(); stopDashboard() }
  }, [familyId, childId, dashboardToken, parent, watchTasks, watchDashboard, diagnosticsContext])
  const matching = tasks?.filter(task => task.learningContext.id === olympiadId) ?? []
  const task = matching[0]
  const dayToken = task && dashboard?.kind === (parent ? 'parent' : 'student') ? dashboard.days.find(day => day.date === task.projectionSourceDate)?.dayToken : null
  useEffect(() => {
    if (task && dayToken) traceOlympiad('page-loaded', diagnosticsContext, parent ? 'parent' : 'student', task.testTokens.length)
  }, [task?.id, dayToken, parent, diagnosticsContext])
  return <section className="day-dashboard-card" aria-label="Подготовка к олимпиаде"><a href={`#/days/${encodeURIComponent(dashboardToken)}`}>← На главную</a>
    {error ? <p role="alert">{error}</p> : !tasks || !dashboard ? <p role="status">Открываем подготовку…</p> : !task ? <p role="alert">Подготовка недоступна.</p> : !dayToken ? <p role="alert">Страница подготовки ещё не опубликована.</p> : <>
      <h1>{task.title}</h1><p>Подготовка — дополнительная работа. Текущие конкурсные задачи выполняются по правилам организатора.</p>
      {renderPractice ? renderPractice(task, dayToken, parent) : <DayPage key={`${familyId}/${childId}/${dayToken}/${task.id}`} token={dayToken} parent={parent} headerReturnTarget={null} olympiadScope={{ familyId, childId, olympiadId, taskId: task.id, testTokens: task.testTokens }} />}
    </>}
  </section>
}
