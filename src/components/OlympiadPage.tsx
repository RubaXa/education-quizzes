import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { traceOlympiad } from '@/lib/browserAccessTrace'
import OlympiadWrittenPractice from './OlympiadWrittenPractice'
import { olympiadPhoto } from '@/lib/olympiad/photoClient'
import OlympiadLesson, { type OlympiadLessonProjection } from './OlympiadLesson'
import { olympiadRequest, type OlympiadAttempt, type OlympiadCatalogItem, type OlympiadScope } from '@/lib/olympiad/client'
import '../DayDashboard.css'

type LessonCommand = { id: string; at: string; type: 'answer'; optionId: string } | { id: string; at: string; type: 'advance' }
type ParentDetail = { view: OlympiadLessonProjection; steps: { id: string; prompt: string; options: {id:string; text:string}[]; correctOptionIds: string[]; correctExplanation?:string; incorrectHint?:string }[]; events: {id:string; stepId:string; type:string; optionId?:string; correct?:boolean; hintShown?:boolean}[] }
/** All data are returned by the role-authorized server, not selected by the URL.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#метрики-и-родительские-проекции */
export default function OlympiadPage({ familyId, childId, olympiadId, parent, dashboardToken, request = olympiadRequest, photo = olympiadPhoto, diagnosticsContext = 'product' }: { familyId:string; childId:string; olympiadId:string; parent:boolean; dashboardToken:string; request?: typeof olympiadRequest; photo?: typeof olympiadPhoto; diagnosticsContext?: 'demo' | 'product' }) {
  const [catalog,setCatalog] = useState<OlympiadCatalogItem>()
  const [problems,setProblems] = useState<{id:string;title:string;statement:string}[]>([])
  const [practiceError,setPracticeError] = useState(false)
  const [attempts,setAttempts] = useState<OlympiadAttempt[]>([])
  const [view,setView] = useState<OlympiadLessonProjection>()
  const [detail,setDetail] = useState<ParentDetail>()
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [activeId,setActiveId] = useState('')
  const pending = useRef<LessonCommand | null>(null)
  const startIds = useRef<Record<string,string>>({})
  const scope = (attemptId:string):OlympiadScope => ({familyId,childId,olympiadId,attemptId})
  useEffect(()=>{
    let active=true
    setProblems([]);setPracticeError(false);setCatalog(undefined);setAttempts([]);setView(undefined);setDetail(undefined);setLoading(true);setError('')
    void Promise.all([request<OlympiadCatalogItem[]>({action:'list',familyId,childId}),request<OlympiadAttempt[]>({action:'list-attempts',scope:{familyId,childId,olympiadId,attemptId:'catalog'}})]).then(([all,found])=>{
      if(!active)return
      const item=all.find(entry=>entry.id===olympiadId)
      if(!item){setError('Подготовка недоступна.');return}
      setCatalog(item);setAttempts(found);if(item.participationEnabled) void request<{id:string;title:string;statement:string}[]>({action:'list-problems',scope:{familyId,childId,olympiadId}}).then(result=>{if(active)setProblems(result)}).catch(()=>{if(active)setPracticeError(true)});traceOlympiad('page-loaded',diagnosticsContext,parent?'parent':'student',found.length)
    }).catch(()=>{if(active){setError('Не удалось открыть подготовку.');traceOlympiad('page-failed',diagnosticsContext,parent?'parent':'student')}}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[familyId,childId,olympiadId,parent,request,diagnosticsContext])
  async function openLesson(lesson:OlympiadCatalogItem['lessons'][number]) {
    const existing=attempts.find(item=>item.lessonId===lesson.id && item.lessonVersion===lesson.version && item.status==='active')
    const attemptId=existing?.attemptId ?? (startIds.current[lesson.id] ??= crypto.randomUUID())
    const result = await request<OlympiadLessonProjection>(existing ? {action:'view',scope:scope(attemptId)} : {action:'start',scope:scope(attemptId),lessonRef:{lessonId:lesson.id,version:lesson.version}})
    setActiveId(attemptId);setView(result);setError('')
  }
  async function command(type:'answer'|'advance',optionId?:string) {
    if(!activeId) throw new Error('Missing attempt')
    let cmd = pending.current
    if(cmd && (cmd.type!==type || cmd.type==='answer' && cmd.optionId!==optionId)) throw new Error('Retry previous action')
    if(!cmd) { cmd = type==='answer' ? {id:crypto.randomUUID(),at:new Date().toISOString(),type,optionId:optionId!} : {id:crypto.randomUUID(),at:new Date().toISOString(),type};pending.current=cmd }
    const next=await request<OlympiadLessonProjection>({action:'act',scope:scope(activeId),command:cmd})
    pending.current=null;setView(next)
  }
  async function openDetail(attemptId:string) {
    const result=await request<ParentDetail>({action:'parent-detail',scope:scope(attemptId)})
    setDetail(result);setError('');traceOlympiad('detail-opened',diagnosticsContext,'parent')
  }
  return <section className="day-dashboard-card" aria-label="Подготовка к олимпиаде"><a href={`#/days/${encodeURIComponent(dashboardToken)}`}>← На главную</a>
    {loading ? <p role="status">Открываем подготовку…</p> : !catalog ? <p role="alert">{error || 'Подготовка недоступна.'}</p> : <>{error && <p role="alert">{error}</p>}<h1>{catalog.title}</h1><p>{catalog.deadline ? `Срок: ${catalog.deadline}` : 'Даты уточняются'}</p>
      <p>Подготовка — дополнительная работа. Текущие конкурсные задачи выполняются по правилам организатора.</p>
      {catalog.sources?.length ? <section aria-label="Источники"><h2>Источники</h2><ul>{catalog.sources.filter(source=>{try{const url=new URL(source.url);return url.protocol==='https:'&&!url.username&&!url.password}catch{return false}}).map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></section> : null}
      {catalog.participationEnabled && <><h2>Игровые уроки</h2>{catalog.lessons.length ? catalog.lessons.map(lesson=><div className="day-dashboard-homework-group" key={lesson.id}><strong>{lesson.title}</strong>{!parent && <Button variant="outline" onClick={()=>void openLesson(lesson).catch(()=>setError('Не удалось открыть урок.'))}>Открыть урок</Button>}</div>) : <p>Уроки ещё готовятся.</p>}</>}
      {catalog.participationEnabled && <section aria-label="Письменная практика"><h2>Письменная практика</h2>{practiceError ? <p role="alert">Не удалось загрузить задачи для практики.</p> : problems.length ? problems.map((problem,index)=><OlympiadWrittenPractice key={problem.id} scope={{familyId,childId,olympiadId,problemId:problem.id}} problem={problem} number={index+1} parent={parent} diagnosticsContext={diagnosticsContext} request={request} photo={photo}/>) : <p>Задачи для практики ещё готовятся.</p>}</section>}
      {parent && attempts.length>0 && <><h2>Попытки</h2>{attempts.map(attempt=><div key={attempt.attemptId}><span>{catalog.lessons.find(item=>item.id===attempt.lessonId)?.title ?? 'Урок'} · {attempt.status==='completed'?'Завершён':'В работе'}</span> <Button variant="outline" onClick={()=>void openDetail(attempt.attemptId).catch(()=>setError('Не удалось открыть разбор.'))}>Разбор</Button></div>)}</>}
      {view && !parent && <OlympiadLesson view={view} diagnosticsContext={diagnosticsContext} onAnswer={id=>command('answer',id)} onAdvance={()=>command('advance')}/>}
      {detail && parent && <section aria-label="Разбор попытки"><h2>Разбор попытки</h2>{detail.steps.map(step=><details key={step.id}><summary>{step.prompt}</summary><p>Верные варианты: {step.options.filter(option=>step.correctOptionIds.includes(option.id)).map(option=>option.text).join(', ')}</p>{step.correctExplanation && <p>Объяснение: {step.correctExplanation}</p>}{detail.events.filter(event=>event.stepId===step.id && event.type==='answer').map(event=><p key={event.id}>Ответ: {step.options.find(option=>option.id===event.optionId)?.text ?? 'Неизвестно'} · {event.correct ? 'верно' : 'ошибка'}{event.hintShown ? ` · подсказка: ${step.incorrectHint ?? 'текст недоступен'}` : ''}</p>)}</details>)}</section>}
    </>}
  </section>
}
