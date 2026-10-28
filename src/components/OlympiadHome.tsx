import { useEffect, useState } from 'react'
import OlympiadCatalog from './OlympiadCatalog'
import { traceOlympiad } from '@/lib/browserAccessTrace'
import { watchFamilyOlympiadTasks, type FamilyOlympiadTask } from '@/lib/educationStore'
import type { OlympiadCatalogItem } from '@/lib/olympiad/client'

/** Family membership and task reads use the same Education data path as other work.
 * @see ../../docs/modules/assessments/olympiad-preparation.md */
export default function OlympiadHome({ familyId, childId, parent, dashboardToken }: { familyId: string; childId: string; parent: boolean; dashboardToken: string }) {
  const [taskState, setTaskState] = useState<{ scope: string; tasks: FamilyOlympiadTask[] }>()
  const scope = `${familyId}/${childId}/${parent ? 'parent' : 'student'}`
  const [error, setError] = useState(false)
  useEffect(() => watchFamilyOlympiadTasks(familyId, childId, data => {
    setTaskState({ scope, tasks: data }); setError(false); traceOlympiad('list-loaded', 'product', parent ? 'parent' : 'student', data.length)
  }, () => { setTaskState({ scope, tasks: [] }); setError(true); traceOlympiad('list-failed', 'product', parent ? 'parent' : 'student') }), [familyId, childId, parent, scope])
  const grouped = new Map<string, OlympiadCatalogItem>()
  for (const task of taskState?.scope === scope ? taskState.tasks : []) if (!grouped.has(task.learningContext.id)) grouped.set(task.learningContext.id, { id: task.learningContext.id, title: task.title, deadline: task.dueDate, participationEnabled: true, lessons: [] })
  if (error) return <p role="status">Не удалось загрузить олимпиады. Обновите страницу, чтобы повторить.</p>
  return <OlympiadCatalog heading="Олимпиадная практика" items={[...grouped.values()]} parent={parent} onExpand={open => traceOlympiad(open ? 'list-opened' : 'list-closed', 'product', parent ? 'parent' : 'student')} onOpen={id => { traceOlympiad('opened', 'product', parent ? 'parent' : 'student'); window.location.hash = `#/olympiad/${encodeURIComponent(dashboardToken)}/${encodeURIComponent(id)}` }} />
}
