import { useEffect, useState, type ReactNode } from 'react'
import DayPage from '../DayPage'
import OlympiadReferences from './OlympiadReferences'
import OlympiadOverview,{OlympiadBackLink} from './OlympiadOverview'
import OlympiadHistory from './OlympiadHistory'
import OlympiadPreparationSummary from './OlympiadPreparationSummary'
import { watchOlympiadHistoryIndex, watchOlympiadHistory, requestHistoryFile } from '@/lib/olympiad/historyStore'
import type { HistoryCompetition, HistoryIndexEntry } from '@/lib/olympiad/historyTypes'
import { traceOlympiad, traceAccess, accessTraceError } from '@/lib/browserAccessTrace'
import { watchFamilyOlympiadTasks, watchPublicOlympiads, watchOlympiadSelections, type FamilyOlympiadTask, type PublicOlympiad } from '@/lib/educationStore'
import { watchDayDashboard, type DayDashboardData } from '@/lib/dayDashboardStore'
import '../DayDashboard.css'

/** Olympiad preparation is a view over the same family task and day page.
 * @see ../../docs/modules/assessments/olympiad-preparation.md */
export default function OlympiadPage({ familyId, childId, olympiadId, parent, dashboardToken, canonicalToken = dashboardToken,
  watchTasks = watchFamilyOlympiadTasks, watchDashboard = watchDayDashboard, watchCatalog = watchPublicOlympiads, watchSelections = watchOlympiadSelections, watchHistoryIndex = watchOlympiadHistoryIndex, watchHistory = watchOlympiadHistory, resolveHistoryFile = requestHistoryFile, renderPractice, diagnosticsContext = 'product' }: {
  familyId: string; childId: string; olympiadId: string; parent: boolean; dashboardToken: string; canonicalToken?: string
  watchTasks?: typeof watchFamilyOlympiadTasks; watchDashboard?: typeof watchDayDashboard; watchCatalog?: typeof watchPublicOlympiads; watchSelections?: typeof watchOlympiadSelections
  watchHistoryIndex?:typeof watchOlympiadHistoryIndex;watchHistory?:typeof watchOlympiadHistory;resolveHistoryFile?:typeof requestHistoryFile
  renderPractice?: (task: FamilyOlympiadTask, dayToken: string, parent: boolean, quizTarget: HTMLElement | null, number: number) => ReactNode
  diagnosticsContext?: 'demo' | 'product'
}) {
  const [tasks, setTasks] = useState<FamilyOlympiadTask[]>()
  const [selections, setSelections] = useState<string[]>()
  const [catalog, setCatalog] = useState<PublicOlympiad[]>()
  const [dashboard, setDashboard] = useState<DayDashboardData>()
  const [error, setError] = useState('')
  const [quizTarget, setQuizTarget] = useState<HTMLDivElement | null>(null)
  const historyScope=`${familyId}/${childId}/${parent?'parent':'student'}/${olympiadId}`
  const [historyIndex,setHistoryIndex]=useState<{scope:string;entries:HistoryIndexEntry[]}>()
  const [historyState,setHistoryState]=useState<{scope:string;value:HistoryCompetition|null}>()
  const [historyError,setHistoryError]=useState(false)
  useEffect(()=>watchHistoryIndex(familyId,childId,entries=>{setHistoryIndex({scope:historyScope,entries});setHistoryError(false)},()=>{setHistoryIndex(undefined);setHistoryState(undefined);setHistoryError(true)}),[familyId,childId,historyScope,watchHistoryIndex])
  const historyEntry=historyIndex?.scope===historyScope?historyIndex.entries.find(e=>e.id===olympiadId||e.aliases.includes(olympiadId)):undefined
  useEffect(()=>{if(!historyEntry)return;return watchHistory(familyId,childId,historyEntry.id,parent,value=>setHistoryState({scope:historyScope,value}),()=>{setHistoryState(undefined);setHistoryError(true)})},[familyId,childId,parent,historyEntry,historyScope,watchHistory])
  const history=historyEntry&&historyState?.scope===historyScope?historyState.value:null
  useEffect(() => {
    setTasks(undefined); setDashboard(undefined); setCatalog(undefined); setSelections(undefined); setError('')
    const fail = (cause: Error) => { traceAccess('access.failed', { atFunction: 'OlympiadPage#load', previousState: 'checking', state: 'failed', source: 'route', code: accessTraceError(cause) }); setTasks(undefined); setDashboard(undefined); setError('Не удалось открыть подготовку.'); traceOlympiad('page-failed', diagnosticsContext, parent ? 'parent' : 'student') }
    const stopSelection = parent ? () => {} : watchSelections(familyId, childId, setSelections, fail)
    const stopCatalog = watchCatalog(setCatalog, fail)
    const stopTasks = watchTasks(familyId, childId, setTasks, fail)
    const stopDashboard = watchDashboard(dashboardToken, setDashboard, fail)
    return () => { stopTasks(); stopDashboard(); stopCatalog(); stopSelection() }
  }, [familyId, childId, dashboardToken, parent, watchTasks, watchDashboard, watchCatalog, watchSelections, diagnosticsContext])
  const publishedOlympiad = catalog?.find(item => item.id === olympiadId)
  const olympiad = publishedOlympiad ?? (historyEntry?{id:olympiadId,title:historyEntry.title,subject:undefined,schedule:undefined,calendar:undefined}:undefined)
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
    return !dayToken ? <p key={task.id} role="alert">«{task.title}»: страница подготовки ещё не опубликована.</p> : <div key={task.id} id={`olympiad-practice-${task.id}`} tabIndex={-1}>{renderPractice ? renderPractice(task, dayToken, parent, quizTarget, number) : <DayPage key={`${familyId}/${childId}/${dayToken}/${task.id}`} token={dayToken} parent={parent} headerReturnTarget={null} olympiadScope={{ familyId, childId, olympiadId, taskId: task.id, testTokens: task.testTokens, number, quizTarget, sourcePhotoIds }} />}</div>
  }
  const canPractice=Boolean(publishedOlympiad&&(parent||selections?.includes(olympiadId)))
  const availablePersonalTasks=canPractice&&projectionReady?matching.filter(task=>!task.sourceIntake&&dashboard?.days.some(day=>day.date===task.projectionSourceDate&&day.dayToken)).map(task=>task.id):[]
  function openPersonalTask(id:string){
    if(!availablePersonalTasks.includes(id))return
    const target=document.getElementById(`olympiad-practice-${id}`)
    target?.scrollIntoView({behavior:'auto',block:'start'});target?.focus({preventScroll:true})
  }
  const sections=[...(history?.preparation?[{id:"olympiad-personal-preparation",label:"Моя подготовка"}]:[]),...(canPractice?[{id:"olympiad-practice-title",label:"Практика",count:prepared.length+uploaded.length}]:[]),...(canPractice&&matching.some(task=>task.testTokens.length>0)?[{id:"olympiad-methods-title",label:"Тесты"}]:[]),...(history?[{id:"olympiad-history",label:"Мои участия"}]:[])]
  return <section className="olympiad-page" aria-label="Подготовка к олимпиаде"><OlympiadBackLink href={`#/days/${encodeURIComponent(canonicalToken)}`}/><div className="day-dashboard-card olympiad-page-body">
    {error ? <p role="alert">{error}</p> : !tasks || !dashboard || !catalog || (!parent && !selections) || !historyIndex&&!historyError ? <p role="status">Открываем олимпиаду…</p> : !parent && !selections?.includes(olympiadId) && !historyEntry ? <p role="alert">Эту олимпиаду ещё не включил родитель.</p> : !olympiad ? <p role="alert">Сведения об олимпиаде недоступны.</p> : <>
      <OlympiadOverview olympiad={olympiad} sections={sections}/>
      {history?.preparation&&<OlympiadPreparationSummary key={historyScope} preparation={history.preparation} familyId={familyId} childId={childId} availableTaskIds={availablePersonalTasks} onOpenTask={openPersonalTask} resolveFile={resolveHistoryFile}/>}
      {historyError&&<p role="status">История временно недоступна. Попробуйте открыть страницу снова.</p>}
      {historyEntry&&historyState?.scope!==historyScope&&!historyError&&<p role="status">Открываем историю работ…</p>}
      {historyEntry&&historyState?.scope===historyScope&&!history&&!historyError&&<p role="status">История ещё не опубликована.</p>}
      {history&&<div id="olympiad-history" className="olympiad-history-target" tabIndex={-1}><OlympiadHistory key={historyScope} competition={history} familyId={familyId} childId={childId} parent={parent} resolveFile={resolveHistoryFile}/></div>}
      {publishedOlympiad&&<OlympiadReferences olympiadId={olympiadId} parent={parent} context={diagnosticsContext} />}
      {(parent||selections?.includes(olympiadId))&&matching.some(task => task.testTokens.length > 0) && <section className="olympiad-section" aria-labelledby="olympiad-methods-title"><h2 id="olympiad-methods-title" tabIndex={-1}>Приёмы и тесты</h2><div className="olympiad-quiz-list" ref={setQuizTarget} /></section>}
      {publishedOlympiad&&(parent||selections?.includes(olympiadId))&&<section className="olympiad-section" aria-labelledby="olympiad-practice-title"><h2 id="olympiad-practice-title" tabIndex={-1}>Практика</h2>{prepared.length + uploaded.length ? <p>Задач: {prepared.length + uploaded.length}. Можно начинать с любой.</p> : <p>Задачи для практики пока не опубликованы.</p>}
        {prepared.length > 0 && <section className="olympiad-practice-group" aria-labelledby="olympiad-prepared-title"><h3 id="olympiad-prepared-title">Задачи для подготовки · {prepared.length}</h3><div className="olympiad-practice-list">{prepared.map((task, index) => renderTask(task, index + 1))}</div></section>}
        {(uploaded.length > 0 || intake.length > 0) && <section className="olympiad-practice-group" aria-labelledby="olympiad-uploaded-title"><h3 id="olympiad-uploaded-title">Загруженные задачи · {uploaded.length}</h3><p>Задачи из ваших фотографий.</p><div className="olympiad-practice-list">{uploaded.map((task, index) => renderTask(task, task.competitionNumber ?? index + 1))}{intake.map(task => renderTask(task, 0))}</div></section>}
      </section>}
    </>}
  </div></section>
}
