import StageAssessmentExample from './StageAssessmentExample'
/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
/** @see ../../docs/decisions/adaptive-review-modes-2026-11-17.md */
import ParentReviewPilotExample from './ParentReviewPilotExample'
import AssignmentClarificationExample from './AssignmentClarificationExample'
import {useEffect,useState} from 'react'
import {decisionNodes,decisionEdges,decisionPresentationBinding} from '../../day/decision-registry.mjs'
import {scenarioRules,scenarioData,missingSourceScenario,sourceContextUpload,sourceContextCrop,type ScenarioVariant} from './decisionScenarioFixtures'
import DecisionTaskDisclosure from '@/components/DecisionTaskDisclosure'
import AssignmentBrief from '@/components/AssignmentBrief'
import SourceFragment from '@/components/SourceFragment'
import QuizCard from '@/components/QuizCard'
import ParentTaskGuide from '@/components/ParentTaskGuide'
import WorkReview from '@/components/WorkReview'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import PhotoUploadControl from '@/components/PhotoUploadControl'
import MaterialRequest from '@/components/MaterialRequest'
import {presentationContracts,presentationContractForRule,problemPresentationErrors,guidePresentationErrors} from '../../packages/education-presentation/task-presentation.mjs'
import {problemCardState} from '@/lib/reviewPresentation'
import {uiKitQuizExamples} from '@/lib/uiKitExamples'
import {reviewBriefWorkExample} from '@/lib/reviewBriefExamples'
import type {DayUpload} from '@/lib/dayStore'
import './DecisionScenarioCatalog.css'
/** Real component compositions, addressable by decision ID, with local-only data.
 * @see ../../docs/modules/reviews/criteria-and-knowledge.md#scenarios
 * @see ../../docs/shared/design/ui-kit.md */
const link=(path:string)=>`https://github.com/RubaXa/education-quizzes/blob/main/${path}`
const states=[['prepared','Подготовлено'],['waiting','Получено · ждёт проверки'],['partial','Есть правка'],['verified','Зачтено'],['unknown','Недостаточно данных'],['missing-source','Не хватает источника']] as const
export default function DecisionScenarioCatalog(){
 const params=new URLSearchParams(window.location.hash.split('?')[1])
 const requested=params.get('decision')
 const [selected,setSelected]=useState(scenarioRules.some(r=>r.id===requested)?requested!:'english.production')
 const [focus,setFocus]=useState(params.get('focus')??'artifact.prepare')
 const [variant,setVariant]=useState<ScenarioVariant>(params.get('example')==='multipart'?'multipart':'single')
 const [role,setRole]=useState<'both'|'parent'|'student'>('both')
 const [state,setState]=useState<typeof states[number][0]>(states.find(([value])=>value===params.get('state'))?.[0]??'partial')
 const [localFiles,setLocalFiles]=useState(0)
 const data=scenarioData(selected,variant),rule=data.rule
 const ruleContract=presentationContractForRule(rule)
 const allowsSourceRequest=!['information','organization'].includes(ruleContract.id)
 const missing=state==='missing-source'&&allowsSourceRequest?missingSourceScenario(selected):undefined
 const mainContract=missing?presentationContracts['source-request']:ruleContract
 const focused=decisionPresentationBinding(focus,selected)??decisionPresentationBinding(rule.nodeId,selected)!
 const contracts=missing?[mainContract]:focused.contractIds.map(id=>presentationContracts[id])
 const presentationErrors=data.problem&&!missing?[...problemPresentationErrors(data.problem),...guidePresentationErrors(data.guide)]:[]
 useEffect(()=>{
  const readHash=()=>{const query=new URLSearchParams(window.location.hash.split('?')[1]);const id=query.get('decision');if(id&&scenarioRules.some(r=>r.id===id)){setSelected(id);setFocus(query.get('focus')??'artifact.prepare');setVariant(query.get('example')==='multipart'?'multipart':'single');setState(states.find(([value])=>value===query.get('state'))?.[0]??'partial')}}
  window.addEventListener('hashchange',readHash);return()=>window.removeEventListener('hashchange',readHash)
 },[])
 function layoutHref(itemId:string,scenarioId=selected){return `#/ui-kit/?${new URLSearchParams({decision:scenarioId,focus:itemId,example:variant,state})}`}
 function selectLayout(itemId:string,scenarioId=selected){setSelected(scenarioId);setFocus(itemId);setRole('both');window.location.hash=layoutHref(itemId,scenarioId).slice(1)}
 const subjectRules=scenarioRules.filter(r=>r.subject===rule.subject)
 const graphNodes=decisionNodes.filter(n=>!n.subject||n.id===rule.nodeId)
 const graphEdges=decisionEdges.filter(e=>graphNodes.some(n=>n.id===e.from)&&graphNodes.some(n=>n.id===e.to))
 const uploads:DayUpload[]=state==='waiting'?[{id:'demo-pending-photo',taskId:data.task.id,status:'pending',originalName:'Условное фото.jpg',contentType:'image/jpeg'}]:[]
 const review=state==='prepared'||state==='waiting'||state==='missing-source'?undefined:reviewBriefWorkExample({id:`demo-${selected}`,status:state==='verified'?'verified':state==='unknown'?'uncertain':'revise',label:state==='verified'?'Все обязательные критерии подтверждены':state==='unknown'?'Недостаточно данных для вывода':'Проверь один открытый критерий',confirmed:state==='verified'?'Назначенное действие выполнено и проверено.':'Подтверждённое не требуется выполнять повторно.',focus:state==='verified'?'Исправлений по этой работе нет.':state==='unknown'?'Нельзя установить результат по имеющимся данным.':rule.checks[0],question:state==='verified'?'Новая обязательная работа не назначается.':data.question})
 const latest=uiKitQuizExamples.at(-1)!
 const maxPoints=2
 function card(parent:boolean){
  const title=parent?'Родитель':'Ученик'
  const sourceStates={prepared:'Источник доступен · разбор ещё не подтверждён',waiting:'Источник получен · ждёт разбора',partial:'Источник разобран частично',verified:'Источник разобран · работа не оценивалась',unknown:'Назначение источника ещё не установлено','missing-source':'Не хватает источника'}
  const statusLabel=missing?'Не хватает источника':rule.product==='verified-material-purpose'?sourceStates[state]:states.find(s=>s[0]===state)![1]
  const points=state==='verified'?maxPoints:state==='partial'?1:undefined
  const quiz={...latest,title:data.task.title,description:undefined,total:1,maxPoints,status:state==='prepared'?'open' as const:'submitted' as const,points,answered:state==='prepared'?0:1,
   results:[{question:{id:'demo-question',kind:'long' as const,prompt:data.question,points:2},answer:state==='prepared'?undefined:'Условный собственный ответ',points:points??null,explanation:state==='verified'?'Ответ соответствует критериям условного задания.':state==='partial'?'Часть критерия требует уточнения.':undefined}]}
  return <section className="edu-decision-role" aria-label={`Карточка: ${title}`} key={`${selected}:${variant}:${parent}:${state}`} data-presentation-contract={mainContract.id}><h3>{title}</h3><DecisionTaskDisclosure subjectId={rule.subject} task={missing?.task??data.task} id={`demo-${selected}-${title}`} title={data.task.title} status={statusLabel} meta={rule.subjectName}>
   {missing?<><AssignmentBrief task={missing.task}/><MaterialRequest request={missing.request} parent={parent} label="Нужен источник" detail="Содержание ещё не установлено."/>{!parent&&<PhotoUploadControl label="Добавить недостающий материал" onPhotos={files=>setLocalFiles(n=>n+files.length)}/>}</>:<>
   {!data.problem&&<AssignmentBrief task={data.task}/>}
   {mainContract.id==='source-context'&&<SourceFragment upload={sourceContextUpload} crop={sourceContextCrop} number={1}/>}
   {data.isQuiz?<QuizCard chain={[quiz]} parent={parent} headingProvided={data.task.title} placementOptional allowFollowupRequest={false} linksEnabled={false}/>:data.problem?<ProblemTaskCard subjectId={rule.subject} problem={data.problem} state={problemCardState(uploads,review)} links={[]} parent={parent} helpAccess="login-required" uploads={uploads} review={review} guide={parent?data.guide:undefined} guidance={[]} guidanceReady onPhotos={files=>setLocalFiles(n=>n+files.length)}/>:<>
    {parent&&mainContract.id==='written-response'&&<ParentTaskGuide guide={data.guide} review={review}/>}
    {!['information','organization','source-context'].includes(mainContract.id)&&<WorkReview parent={parent} review={rule.product==='verified-material-purpose'?undefined:review} uploads={uploads}/>}
    {!parent&&!['information','organization','source-context'].includes(mainContract.id)&&<PhotoUploadControl label={rule.product==='verified-material-purpose'?'Добавить материал':'Добавить файл работы'} onPhotos={files=>setLocalFiles(n=>n+files.length)}/>}
   </>}
   {rule.product==='comprehension-quiz-and-separate-oral-evidence'&&<p>Понимание и выразительное чтение проверяются отдельно. Устное исполнение в этом примере ещё не подтверждено.</p>}
   </>}
  </DecisionTaskDisclosure></section>
 }
 return <section aria-label="Предметные карточки и граф решений"><h2>Предметные карточки и граф решений</h2><p>Условные задания. Те же компоненты и рамка, что на странице дня. Выборы не меняют семейные данные.</p>
  <div className="edu-kit-controls edu-decision-controls"><label>Предмет<select aria-label="Предмет сценария" value={rule.subject} onChange={e=>{setSelected(scenarioRules.find(r=>r.subject===e.target.value)!.id);setLocalFiles(0);setFocus('artifact.prepare')}}>{[...new Set(scenarioRules.map(r=>r.subject))].map(s=><option key={s} value={s}>{scenarioRules.find(r=>r.subject===s)!.subjectName}</option>)}</select></label><label>Вид задания<select aria-label="Вид задания" value={selected} onChange={e=>{setSelected(e.target.value);setLocalFiles(0);setFocus('artifact.prepare')}}>{subjectRules.map(r=><option key={r.id} value={r.id}>{r.when}</option>)}</select></label>{data.problem&&<label>Пример<select aria-label="Состав задачи" value={variant} onChange={e=>setVariant(e.target.value as ScenarioVariant)}><option value="single">Одна задача</option><option value="multipart">Два подпункта</option></select></label>}</div>
  <div className="edu-kit-presets" aria-label="Роли карточки">{([['both','Обе роли'],['parent','Родитель'],['student','Ученик']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={role===value} onClick={()=>setRole(value)}>{label}</button>)}</div>
  <div className="edu-kit-presets" aria-label="Состояние карточки">{states.filter(([value])=>value!=='missing-source'||allowsSourceRequest).map(([value,label])=><button type="button" key={value} aria-pressed={state===value} onClick={()=>setState(value)}>{label}</button>)}</div>
  <details className="edu-decision-inspector" open data-focused-graph-item={focused.item.id}><summary>Связь с решением · {selected}</summary>
   <p><code>{rule.nodeId}</code> → <code>{rule.product}</code> · макет «{mainContract.title}»</p>
   <p><a href={link(rule.specRef)}>Спецификация ветви</a> · <a href={link(rule.decisionRef)}>Почему принято решение</a> · <a href={layoutHref(focused.item.id)}>Адрес этого сценария</a></p>
   <section className="edu-decision-layout-inspector" aria-label="Макет выбранного узла или перехода"><h3>{focused.item.label}</h3><p><code>{focused.item.id}</code></p>
    {focused.technical&&<p>{focused.note}</p>}
    {missing&&<p>Предметная подготовка приостановлена до получения указанного источника. Готовность задания и зачёт не подтверждаются.</p>}
    {contracts.map(contract=><div key={contract.id} data-inspected-contract={contract.id}><h4>{contract.title}</h4><p>Компоненты: {contract.components.join(' → ')}</p><p>Состав: {contract.requiredFields.join(' · ')}</p><ul>{contract.checks.map(check=><li key={check}>{check}</li>)}</ul><a href={link(contract.specRef)}>Контракт макета</a></div>)}
    {data.problem&&!missing&&<p role="status">{presentationErrors.length?`Модель не прошла барьер: ${presentationErrors.join(' ')}`:'Модель примера прошла общий барьер данных, искомого и структурированного родительского пути.'}</p>}
   </section>
   <p>Код выбирает ветвь и проверяет структуру. Агент сверяет источник, метод и содержание. Зачёт проходит обязательный барьер критериев; наблюдение знаний сохраняется отдельно.</p>
   <details><summary>Каждый узел и переход этого пути</summary><ol>{graphNodes.map(n=><li key={n.id}><code>{n.id}</code> — {n.label} · {n.actor} · <a href={layoutHref(n.id,n.uiScenarioId??selected)} onClick={e=>{e.preventDefault();selectLayout(n.id,n.uiScenarioId??selected)}} aria-label={`Макет узла ${n.id}`}>Макет</a> · <a href={link(n.specRef)}>Контракт</a> · <a href={link(n.decisionRef)}>Решение</a></li>)}</ol><ul>{graphEdges.map(e=><li key={e.id}><code>{e.id}</code>: {e.from} → {e.to} · <a href={layoutHref(e.id,e.uiScenarioId??selected)} onClick={event=>{event.preventDefault();selectLayout(e.id,e.uiScenarioId??selected)}} aria-label={`Макет перехода ${e.id}`}>Макет</a> · <a href={link(e.specRef)}>Контракт перехода</a> · <a href={link(e.decisionRef)}>Основание</a></li>)}</ul></details>
  </details>
  {focus==='assessment:stage'?<StageAssessmentExample/>:['view.parent-review','view.student-support','role:parent','role:student','parent:component','student:component'].includes(focus)?<ParentReviewPilotExample/>:<div className="edu-decision-roles">{role!=='student'&&card(true)}{role!=='parent'&&card(false)}</div>}
  {['learner.context','family.requirement','context:clarification','clarification:family'].includes(focus)&&<AssignmentClarificationExample key={selected} task={data.task} subjectName={rule.subjectName}/>}
  {['view.parent-review','view.student-support','role:parent','role:student','parent:component','student:component'].includes(focus)&&<p>Одна задача в двух ролях: <a href="#/ui-kit/?section=compact-review&focus=review.roles">полный ответ родителю и шаг ребёнку</a>.</p>}
  {focus==='review.support'&&<p>Режим текущего вопроса: <a href="#/ui-kit/?section=compact-review&focus=review.support">проверить общий блок и переходы</a>.</p>}
  {localFiles>0&&<p role="status">Выбрано файлов в примере: {localFiles}. Они остаются локальными.</p>}
 </section>
}
