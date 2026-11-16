import {useState} from 'react'
import {decisionNodes,decisionEdges} from '../../day/decision-registry.mjs'
import {scenarioRules,scenarioData} from './decisionScenarioFixtures'
import DecisionTaskDisclosure from '@/components/DecisionTaskDisclosure'
import AssignmentBrief from '@/components/AssignmentBrief'
import QuizCard from '@/components/QuizCard'
import ParentTaskGuide from '@/components/ParentTaskGuide'
import WorkReview from '@/components/WorkReview'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import PhotoUploadControl from '@/components/PhotoUploadControl'
import {problemCardState} from '@/lib/reviewPresentation'
import {uiKitQuizExamples} from '@/lib/uiKitExamples'
import {reviewBriefWorkExample} from '@/lib/reviewBriefExamples'
import type {DayUpload} from '@/lib/dayStore'
import './DecisionScenarioCatalog.css'
/** Real component compositions, addressable by decision ID, with local-only data.
 * @see ../../docs/modules/reviews/criteria-and-knowledge.md#scenarios
 * @see ../../docs/shared/design/ui-kit.md */
const link=(path:string)=>`https://github.com/RubaXa/education-quizzes/blob/main/${path}`
const states=[['prepared','Подготовлено'],['waiting','Получено · ждёт проверки'],['partial','Есть правка'],['verified','Зачтено'],['unknown','Недостаточно данных']] as const
export default function DecisionScenarioCatalog(){
 const requested=new URLSearchParams(window.location.hash.split('?')[1]).get('decision')
 const [selected,setSelected]=useState(scenarioRules.some(r=>r.id===requested)?requested!:'english.production')
 const [role,setRole]=useState<'both'|'parent'|'student'>('both')
 const [state,setState]=useState<typeof states[number][0]>('partial')
 const [localFiles,setLocalFiles]=useState(0)
 const data=scenarioData(selected),rule=data.rule
 const subjectRules=scenarioRules.filter(r=>r.subject===rule.subject)
 const graphNodes=decisionNodes.filter(n=>!n.subject||n.id===rule.nodeId)
 const graphEdges=decisionEdges.filter(e=>graphNodes.some(n=>n.id===e.from)&&graphNodes.some(n=>n.id===e.to))
 const uploads:DayUpload[]=state==='waiting'?[{id:'demo-pending-photo',taskId:data.task.id,status:'pending',originalName:'Условное фото.jpg',contentType:'image/jpeg'}]:[]
 const review=state==='prepared'||state==='waiting'?undefined:reviewBriefWorkExample({id:`demo-${selected}`,status:state==='verified'?'verified':state==='unknown'?'uncertain':'revise',label:state==='verified'?'Все обязательные критерии подтверждены':state==='unknown'?'Недостаточно данных для вывода':'Проверь один открытый критерий',confirmed:state==='verified'?'Назначенное действие выполнено и проверено.':'Подтверждённое не требуется выполнять повторно.',focus:state==='verified'?'Исправлений по этой работе нет.':state==='unknown'?'Нельзя установить результат по имеющимся данным.':rule.checks[0],question:state==='verified'?'Новая обязательная работа не назначается.':data.question})
 const latest=uiKitQuizExamples.at(-1)!
 const maxPoints=2
 function card(parent:boolean){
  const title=parent?'Родитель':'Ученик'
  const statusLabel=state==='verified'&&rule.product==='verified-material-purpose'?'Источник разобран · работа не оценивалась':states.find(s=>s[0]===state)![1]
  const points=state==='verified'?maxPoints:state==='partial'?1:undefined
  const quiz={...latest,title:data.task.title,description:undefined,total:1,maxPoints,status:state==='prepared'?'open' as const:'submitted' as const,points,answered:state==='prepared'?0:1,
   results:[{question:{id:'demo-question',kind:'long' as const,prompt:data.question,points:2},answer:state==='prepared'?undefined:'Условный собственный ответ',points:points??null,explanation:state==='verified'?'Ответ соответствует критериям условного задания.':state==='partial'?'Часть критерия требует уточнения.':undefined}]}
  return <section className="edu-decision-role" aria-label={`Карточка: ${title}`} key={`${selected}:${parent}:${state}`}><h3>{title}</h3><DecisionTaskDisclosure subjectId={rule.subject} task={data.task} id={`demo-${selected}-${title}`} title={data.task.title} status={statusLabel} meta={rule.subjectName}>
   <AssignmentBrief task={data.task}/>
   {data.isQuiz?<QuizCard chain={[quiz]} parent={parent} headingProvided={data.task.title} placementOptional allowFollowupRequest={false} linksEnabled={false}/>:rule.id==='special.sheet'?<ProblemTaskCard subjectId={rule.subject} problem={{id:data.task.id,number:1,title:'Задача № 1 · условный пример',detail:data.task.detail,source:'Условный лист UI Kit',original:{text:data.task.detail,attachmentRef:'demo-sheet'}}} state={problemCardState(uploads,review)} links={[]} parent={parent} helpAccess="login-required" uploads={uploads} review={review} guide={parent?data.guide:undefined} guidance={[]} guidanceReady onPhotos={files=>setLocalFiles(n=>n+files.length)}/>:<>
    {parent&&<ParentTaskGuide guide={data.guide} review={review}/>}
    <WorkReview parent={parent} review={rule.product==='verified-material-purpose'?undefined:review} uploads={uploads}/>
    {!parent&&!['information-without-homework','dated-organisational-action'].includes(rule.product)&&<PhotoUploadControl label={rule.product==='verified-material-purpose'?'Добавить материал':'Добавить файл работы'} onPhotos={files=>setLocalFiles(n=>n+files.length)}/>}
   </>}
   {rule.product==='comprehension-quiz-and-separate-oral-evidence'&&<p>Понимание и выразительное чтение проверяются отдельно. Устное исполнение в этом примере ещё не подтверждено.</p>}
  </DecisionTaskDisclosure></section>
 }
 return <section aria-label="Предметные карточки и граф решений"><h2>Предметные карточки и граф решений</h2><p>Условные задания. Те же компоненты и рамка, что на странице дня. Выборы не меняют семейные данные.</p>
  <div className="edu-kit-controls edu-decision-controls"><label>Предмет<select aria-label="Предмет сценария" value={rule.subject} onChange={e=>{setSelected(scenarioRules.find(r=>r.subject===e.target.value)!.id);setLocalFiles(0)}}>{[...new Set(scenarioRules.map(r=>r.subject))].map(s=><option key={s} value={s}>{scenarioRules.find(r=>r.subject===s)!.subjectName}</option>)}</select></label><label>Вид задания<select aria-label="Вид задания" value={selected} onChange={e=>{setSelected(e.target.value);setLocalFiles(0)}}>{subjectRules.map(r=><option key={r.id} value={r.id}>{r.when}</option>)}</select></label></div>
  <div className="edu-kit-presets" aria-label="Роли карточки">{([['both','Обе роли'],['parent','Родитель'],['student','Ученик']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={role===value} onClick={()=>setRole(value)}>{label}</button>)}</div>
  <div className="edu-kit-presets" aria-label="Состояние карточки">{states.map(([value,label])=><button type="button" key={value} aria-pressed={state===value} onClick={()=>setState(value)}>{label}</button>)}</div>
  <details className="edu-decision-inspector" open><summary>Связь с решением · {selected}</summary><p><code>{rule.nodeId}</code> → <code>{rule.product}</code></p><p><a href={link(rule.specRef)}>Спецификация ветви</a> · <a href={link(rule.decisionRef)}>Почему принято решение</a> · <a href={`#/ui-kit/?decision=${selected}`}>Адрес этого сценария</a></p><p>Код выбирает ветвь и проверяет структуру. Агент сверяет источник, метод и содержание. Зачёт проходит обязательный барьер критериев; наблюдение знаний сохраняется отдельно.</p><details><summary>Каждый узел и переход этого пути</summary><ol>{graphNodes.map(n=><li key={n.id}><code>{n.id}</code> — {n.label} · {n.actor} · <a href={link(n.specRef)}>Контракт</a> · <a href={link(n.decisionRef)}>Решение</a></li>)}</ol><ul>{graphEdges.map(e=><li key={e.id}><code>{e.id}</code>: {e.from} → {e.to} · <a href={link(e.specRef)}>Контракт перехода</a> · <a href={link(e.decisionRef)}>Основание</a></li>)}</ul></details></details>
  <div className="edu-decision-roles">{role!=='student'&&card(true)}{role!=='parent'&&card(false)}</div>
  {localFiles>0&&<p role="status">Выбрано файлов в примере: {localFiles}. Они остаются локальными.</p>}
 </section>
}
