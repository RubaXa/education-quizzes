import { useEffect, useState } from 'react'
import OlympiadCatalog from './OlympiadCatalog'
import { traceOlympiad } from '@/lib/browserAccessTrace'
import { watchFamilyOlympiadTasks, watchPublicOlympiads, watchOlympiadGrade, watchOlympiadSelections, setOlympiadSelection, type FamilyOlympiadTask, type PublicOlympiad } from '@/lib/educationStore'
import type { OlympiadCatalogItem } from '@/lib/olympiad/client'
import { watchOlympiadHistoryIndex } from '@/lib/olympiad/historyStore'
import type { HistoryIndexEntry } from '@/lib/olympiad/historyTypes'

/** Family membership and task reads use the same Education data path as other work.
 * @see ../../docs/modules/assessments/olympiad-preparation.md */
export default function OlympiadHome({ familyId, childId, parent, dashboardToken }: { familyId: string; childId: string; parent: boolean; dashboardToken: string }) {
  const [taskState, setTaskState] = useState<{ scope: string; tasks: FamilyOlympiadTask[] }>()
  const scope = `${familyId}/${childId}/${parent ? 'parent' : 'student'}`
  const [historyState,setHistoryState]=useState<{scope:string;items:HistoryIndexEntry[]}>()
  const [historyError,setHistoryError]=useState(false)
  useEffect(()=>watchOlympiadHistoryIndex(familyId,childId,items=>{setHistoryState({scope,items});setHistoryError(false)},()=>{setHistoryState(undefined);setHistoryError(true)}),[familyId,childId,scope])
  const [error, setError] = useState(false)
  const [catalog, setCatalog] = useState<PublicOlympiad[]>([])
  const [grade, setGrade] = useState<number | null>(null)
  useEffect(() => watchOlympiadGrade(familyId, childId, setGrade, () => setGrade(null)), [familyId, childId])
  const [catalogError, setCatalogError] = useState(false)
  const [selectionState, setSelectionState] = useState<{ scope: string; ids: string[] }>()
  useEffect(() => watchOlympiadSelections(familyId, childId, ids => setSelectionState({ scope, ids }), () => { setSelectionState(undefined); setError(true) }), [familyId, childId, scope])
  useEffect(() => watchPublicOlympiads(items => { setCatalog(items); setCatalogError(false) }, () => { setCatalog([]); setCatalogError(true) }), [])
  useEffect(() => watchFamilyOlympiadTasks(familyId, childId, data => {
    setTaskState({ scope, tasks: data }); setError(false); traceOlympiad('list-loaded', 'product', parent ? 'parent' : 'student', data.length)
  }, () => { setTaskState({ scope, tasks: [] }); setError(true); traceOlympiad('list-failed', 'product', parent ? 'parent' : 'student') }), [familyId, childId, parent, scope])
  const grouped = new Map<string, OlympiadCatalogItem>()
  for (const item of catalog.filter(item => grade === null || item.gradeLevels.includes(grade))) grouped.set(item.id, { ...item, eligibility: grade === null ? 'unknown' : 'eligible', participationEnabled: selectionState?.scope === scope && selectionState.ids.includes(item.id), practiceAvailable: false, lessons: [] })
  for (const task of taskState?.scope === scope ? taskState.tasks : []) {
    const olympiad = grouped.get(task.learningContext.id)
    grouped.set(task.learningContext.id, { ...olympiad, id: task.learningContext.id, title: olympiad?.title ?? 'Олимпиада — название уточняется', deadline: olympiad?.deadline ?? null, eligibility: olympiad?.eligibility ?? 'unknown', subject: olympiad?.subject, schedule: olympiad?.schedule, participationEnabled: selectionState?.scope === scope && selectionState.ids.includes(task.learningContext.id), practiceAvailable: true, lessons: [] })
  }
  for(const entry of historyState?.scope===scope?historyState.items:[]){
    const linked=catalog.find(item=>entry.aliases.includes(item.id))
    const id=linked?.id??entry.id,existing=grouped.get(id)
    grouped.set(id,{...existing,id,title:linked?.title??entry.title,deadline:existing?.deadline??null,participationEnabled:existing?.participationEnabled??false,practiceAvailable:existing?.practiceAvailable??false,history:entry,historicalOnly:!linked||grade!==null&&!linked.gradeLevels.includes(grade),lessons:existing?.lessons??[]})
  }
  if (error) return <p role="status">Не удалось загрузить олимпиады. Обновите страницу, чтобы повторить.</p>
  return <>{historyError && <p role="status">История временно недоступна. Текущая подготовка сохранена.</p>}{catalogError && <p role="status">Общий каталог временно недоступен; показываем семейную практику.</p>}<OlympiadCatalog heading="Олимпиады" items={[...grouped.values()]} parent={parent} onParticipation={parent && selectionState?.scope === scope ? async (id, enabled) => { try { await setOlympiadSelection(familyId, childId, id, enabled); traceOlympiad('participation-changed', 'product', 'parent') } catch (cause) { traceOlympiad('participation-failed', 'product', 'parent'); throw cause } } : undefined} onExpand={open => traceOlympiad(open ? 'list-opened' : 'list-closed', 'product', parent ? 'parent' : 'student')} onOpen={id => { traceOlympiad('opened', 'product', parent ? 'parent' : 'student'); window.location.hash = `#/olympiad/${encodeURIComponent(dashboardToken)}/${encodeURIComponent(id)}` }} /></>
}
