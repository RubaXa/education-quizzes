import { useMemo, useState } from 'react'
import { ArrowRight, FileText, X } from 'lucide-react'
import { Button } from './ui/button'
import { HistoryFiles } from './OlympiadHistory'
import { requestHistoryFile } from '@/lib/olympiad/historyStore'
import type { PersonalPreparation, PreparationPoint } from '@/lib/olympiad/historyTypes'
import './OlympiadPreparationSummary.css'

/** A short personal route over existing family tasks and historical originals.
 * @see ../../docs/modules/assessments/olympiad-history.md#персональная-подготовка */
export default function OlympiadPreparationSummary({preparation,familyId,childId,availableTaskIds,onOpenTask,resolveFile=requestHistoryFile}:{
 preparation:PersonalPreparation;familyId:string;childId:string;availableTaskIds:readonly string[];onOpenTask:(id:string)=>void;resolveFile?:typeof requestHistoryFile
}){
 const scope=`${familyId}/${childId}`
 const [selection,setSelection]=useState<{scope:string;id:string}>()
 const selected=selection?.scope===scope?preparation.evidence.find(e=>e.id===selection.id):undefined
 const files=useMemo(()=>selected?[selected.file]:[],[selected])
 function evidence(ids:string[]){return ids.map(id=>{const work=preparation.evidence.find(e=>e.id===id);return work?<Button key={id} variant="link" size="sm" className="olympiad-preparation-evidence" aria-expanded={selected?.id===id} onClick={()=>setSelection(selected?.id===id?undefined:{scope,id})}><FileText size={14} aria-hidden="true"/>{work.label}</Button>:null})}
 function points(title:string,items:PreparationPoint[]){return <div className="olympiad-preparation-group"><h3>{title}</h3>{items.length?<ul>{items.map((point,index)=><li key={index}><p>{point.text}</p><div className="olympiad-preparation-links">{evidence(point.evidenceIds)}</div></li>)}</ul>:<p>{title==='Над чем работаем'&&preparation.progress?.exhausted?'Все задачи этого маршрута зачтены.':'Пока недостаточно подтверждённых работ.'}</p>}</div>}
 const checked=preparation.progress?.tasks??[],credited=checked.filter(t=>t.credited)
 const next=preparation.next,canStart=next&&availableTaskIds.includes(next.taskId)
 return <section id="olympiad-personal-preparation" tabIndex={-1} className="olympiad-section olympiad-preparation-summary" aria-label="Моя подготовка">
  <div className="olympiad-preparation-heading"><h2>Моя подготовка</h2><p>По работам на <time dateTime={preparation.updatedOn}>{new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${preparation.updatedOn}T12:00:00Z`))}</time></p></div>
  <div className="olympiad-preparation-columns">{points('Уже получается',preparation.strengths)}{points('Над чем работаем',preparation.workingOn)}</div>
  {checked.length>0&&<details className="olympiad-preparation-reviews"><summary>Проверенные работы · {checked.length}{credited.length>0?` · зачтено ${credited.length}`:''}</summary><ul>{checked.map(task=><li key={task.taskId}><h3>{task.title}</h3><p className="olympiad-preparation-meta">{task.checkedOn} · {task.credited==='review'?'Зачтено проверкой':task.credited==='family'?'Принято по семейному плану':task.status==='needs-fix'?'Нужно исправить':'Нужно дополнить'}{task.achievedOn&&!task.credited?` · ранее зачтено ${task.achievedOn}`:''}</p>{task.confirmed&&<p>{task.confirmed}</p>}{task.focus&&<p>{task.focus}</p>}{availableTaskIds.includes(task.taskId)&&<Button variant="link" onClick={()=>onOpenTask(task.taskId)}>Работа и история попыток<ArrowRight size={16} aria-hidden="true"/></Button>}</li>)}</ul></details>}
  <div className="olympiad-preparation-next"><h3>Следующая задача</h3>{next?<><p className="olympiad-preparation-task-title">{next.title}</p><p>{next.reason}</p><div className="olympiad-preparation-links">{evidence(next.evidenceIds)}</div>{canStart?<Button onClick={()=>onOpenTask(next.taskId)}>Открыть задачу<ArrowRight size={16} aria-hidden="true"/></Button>:<p className="olympiad-preparation-meta">Эта задача пока недоступна в практике.</p>}</>:<p>{preparation.progress?.exhausted?'Все задачи этого маршрута зачтены. Новую задачу выберем отдельно.':'Следующий шаг пока не выбран.'}</p>}</div>
  {selected&&<div className="olympiad-preparation-work" role="region" aria-label={`Прошлая работа: ${selected.label}`}><div className="olympiad-preparation-work-heading"><h3>{selected.label}</h3><Button variant="ghost" size="sm" onClick={()=>setSelection(undefined)} aria-label="Закрыть прошлую работу"><X size={16} aria-hidden="true"/></Button></div><HistoryFiles key={`${scope}/${selected.id}`} files={files} familyId={familyId} childId={childId} resolveFile={resolveFile} autoOpen/></div>}
 </section>
}
