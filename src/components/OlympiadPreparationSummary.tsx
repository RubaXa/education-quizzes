import { useMemo, useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Button } from './ui/button'
import { HistoryFiles } from './OlympiadHistory'
import { requestHistoryFile } from '@/lib/olympiad/historyStore'
import type { PersonalPreparation, PreparationPoint } from '@/lib/olympiad/historyTypes'
import './OlympiadPreparationSummary.css'
import OlympiadNextStep from './OlympiadNextStep'

/** A short personal route over existing family tasks and historical originals.
 * @see ../../docs/modules/assessments/olympiad-history.md#персональная-подготовка */
export default function OlympiadPreparationSummary({preparation,familyId,childId,availableTaskIds,onOpenTask,nextPresented=false,resolveFile=requestHistoryFile}:{
 preparation:PersonalPreparation;nextPresented?:boolean;familyId:string;childId:string;availableTaskIds:readonly string[];onOpenTask:(id:string)=>void;resolveFile?:typeof requestHistoryFile
}){
 const scope=`${familyId}/${childId}`
 const [selection,setSelection]=useState<{scope:string;id:string}>()
 const selected=selection?.scope===scope?preparation.evidence.find(e=>e.id===selection.id):undefined
 const files=useMemo(()=>selected?[selected.file]:[],[selected])
 function evidence(ids:string[]){return ids.map(id=>{const work=preparation.evidence.find(e=>e.id===id);return work?<Button key={id} variant="link" size="sm" className="olympiad-preparation-evidence" aria-expanded={selected?.id===id} onClick={()=>setSelection(selected?.id===id?undefined:{scope,id})}><FileText size={14} aria-hidden="true"/>{work.label}</Button>:null})}
 function points(title:string,items:PreparationPoint[]){return <div className="olympiad-preparation-group"><h3>{title}</h3>{items.length?<ul>{items.map((point,index)=><li key={index}><p>{point.text}</p><div className="olympiad-preparation-links">{evidence(point.evidenceIds)}</div></li>)}</ul>:<p>Пока недостаточно подтверждённых работ.</p>}</div>}
 const next=preparation.next
 return <section id="olympiad-personal-preparation" tabIndex={-1} className="olympiad-section olympiad-preparation-summary" aria-label="Моя подготовка">
  <div className="olympiad-preparation-heading"><h2>Моя подготовка</h2><p>По работам на <time dateTime={preparation.updatedOn}>{new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${preparation.updatedOn}T12:00:00Z`))}</time></p></div>
  <div className="olympiad-preparation-columns">{points('Уже получается',preparation.strengths)}{points('Над чем работаем',preparation.workingOn)}</div>
  {nextPresented?next&&next.evidenceIds.length>0&&<details className="olympiad-preparation-next-evidence"><summary>Опора для следующего шага</summary><div className="olympiad-preparation-links">{evidence(next.evidenceIds)}</div></details>:<OlympiadNextStep next={next} availableTaskIds={availableTaskIds} onOpenTask={onOpenTask}><div className="olympiad-preparation-links">{next&&evidence(next.evidenceIds)}</div></OlympiadNextStep>}
  {selected&&<div className="olympiad-preparation-work" role="region" aria-label={`Прошлая работа: ${selected.label}`}><div className="olympiad-preparation-work-heading"><h3>{selected.label}</h3><Button variant="ghost" size="sm" onClick={()=>setSelection(undefined)} aria-label="Закрыть прошлую работу"><X size={16} aria-hidden="true"/></Button></div><HistoryFiles key={`${scope}/${selected.id}`} files={files} familyId={familyId} childId={childId} resolveFile={resolveFile} autoOpen/></div>}
 </section>
}
