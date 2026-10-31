import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import WorkPhotoGallery from './WorkPhotoGallery'
import type { DayUpload } from '@/lib/dayStore'
import type { HistoryCompetition, HistoryFile, HistoryStage } from '@/lib/olympiad/historyTypes'
import { requestHistoryFile } from '@/lib/olympiad/historyStore'
import './OlympiadHistory.css'

const points=(score:number|null,maximum:number|null)=>score===null?'Нет подтверждённого балла':maximum===null?`${score} баллов`:`${score} из ${maximum}`
const state=(value:string)=>value==='preliminary'?'Предварительный результат':value==='appeal-window'?'Снимок периода апелляций':value==='jury-final'?'Итог жюри':value==='material-only'?'Архивный материал':value==='unknown'?'Результат уточняется':'По сохранённому результату'
const role=(value:string)=>({solution:'Решение',source:'Условия',result:'Результат',feedback:'Ответы и разбор','work-feedback':'Ответ и проверка',context:'Материалы этапа',identity:'Данные участника'}[value]??'Архивный файл')

/** A history stage reuses the current read-only work gallery; no upload or new attempt.
 * @see ../../docs/modules/assessments/olympiad-history.md */
export function HistoryFiles({files,familyId,childId,resolveFile,autoOpen=false}:{autoOpen?:boolean;files:HistoryFile[];familyId:string;childId:string;resolveFile:typeof requestHistoryFile}){
 const [request,setRequest]=useState(0),[value,setValue]=useState<{key:string;uploads:DayUpload[];failed:number}>(),[now]=useState(Date.now)
 const key=`${familyId}/${childId}/${files.map(f=>f.id).join(':')}/${request}`
 useEffect(()=>{
  let active=true;const owned:string[]=[]
  void Promise.allSettled(files.map(async file=>{const url=await resolveFile(familyId,childId,file.id);if(url.startsWith('blob:')){if(active)owned.push(url);else URL.revokeObjectURL(url)};return {id:file.id,taskId:'history',status:'reviewed' as const,origin:'archive' as const,contentType:file.contentType,originalName:file.name,size:file.size,dataUrl:url}})).then(results=>{
   if(!active)return
   setValue({key,uploads:results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]),failed:results.filter(r=>r.status==='rejected').length})
  })
  return ()=>{active=false;owned.forEach(url=>URL.revokeObjectURL(url))}
 },[key,files,familyId,childId,resolveFile,request])
 const current=value?.key===key?value:undefined
 const pending=!current
 return <div className="olympiad-history-files">
  {pending&&<p role="status">Открываем архивные файлы…</p>}
  {current&&current.uploads.length>0&&<WorkPhotoGallery studentToken="historical-archive" taskTitle="Архивная работа" uploads={current.uploads} localPhotos={[]} now={now} evidenceLabel="Архивные файлы" purpose="archive" initialSelectedId={autoOpen?current.uploads[0]?.id:undefined} />}
  {current&&current.failed>0&&<p role="alert">Недоступно файлов: {current.failed}. <Button variant="outline" size="sm" onClick={()=>setRequest(v=>v+1)}>Повторить</Button></p>}
  <ul className="olympiad-history-file-list">{files.map(file=><li key={file.id}>{role(file.role)} · {file.name}</li>)}</ul>
 </div>
}

function Stage({stage,familyId,childId,parent,resolveFile}:{stage:HistoryStage;familyId:string;childId:string;parent:boolean;resolveFile:typeof requestHistoryFile}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState<number|null>(null)
 const task=stage.tasks.find(t=>t.number===selected)
 const files=task?stage.files.filter(f=>task.fileIds.includes(f.id)):stage.files
 return <details className="olympiad-history-stage" onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open)}}>
  <summary><strong>{stage.label}</strong><span>{points(stage.score,stage.maximum)}</span></summary>
  {open&&<div className="olympiad-history-stage-body">
   <p>{state(stage.state)}{stage.date&&<> · <time dateTime={stage.date}>{new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC'}).format(new Date(`${stage.date}T12:00:00Z`))}</time></>}</p>
   {stage.award&&<p><strong>{stage.award}</strong></p>}{stage.rank!==null&&<p>Место: {stage.rank}. Число участников неизвестно.</p>}
   {stage.notes.map((note,i)=><p key={i}>{note}</p>)}
   {stage.tasks.length>0&&<table className="olympiad-history-table"><caption>Баллы и работы по задачам</caption><thead><tr><th scope="col">№</th><th scope="col">Баллы</th><th scope="col">Работа</th></tr></thead><tbody>{stage.tasks.map(item=><tr key={item.number}><th scope="row">{item.label??item.number}</th><td>{item.score===null?'—':item.maximum===null?item.score:`${item.score}/${item.maximum}`}</td><td><Button variant="ghost" size="sm" aria-pressed={selected===item.number} onClick={()=>setSelected(selected===item.number?null:item.number)}>Открыть №{item.label??item.number}</Button></td></tr>)}</tbody></table>}
   {task&&<div className="olympiad-history-task"><h4>Задача №{task.label??task.number}</h4>{task.statement&&<p className="olympiad-history-statement">{task.statement}</p>}{task.pages&&<p>{task.pages}</p>}<Button variant="outline" size="sm" onClick={()=>setSelected(null)}>Все файлы этапа</Button></div>}
   {!stage.files.some(file=>['solution','work-feedback'].includes(file.role))&&stage.score!==null&&<p>Результат есть; исходное решение не загружено.</p>}
   {files.length>0?<HistoryFiles key={`${stage.id}:${selected??'all'}`} files={files} familyId={familyId} childId={childId} resolveFile={resolveFile}/>:<p>Файлов этого номера пока нет.</p>}
   {parent&&stage.parentNotes?.length? <details><summary>Примечания к источникам</summary>{stage.parentNotes.map((note,i)=><p key={i}>{note}</p>)}</details>:null}
   <p className="olympiad-history-source-note">Помощь при выполнении неизвестна. Архивный балл и последующий учебный разбор учитываются отдельно.</p>
   {stage.receivedOn&&<p className="olympiad-history-source-note">Получено в архив: <time dateTime={stage.receivedOn}>{new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC'}).format(new Date(`${stage.receivedOn}T12:00:00Z`))}</time>. Это не дата новой попытки.</p>}
  </div>}
 </details>
}

/** Same season/stage view for both members; its authorized projection is selected before rendering.
 * @see ../../docs/modules/assessments/olympiad-history.md */
export default function OlympiadHistory({competition,familyId,childId,parent,resolveFile=requestHistoryFile}:{competition:HistoryCompetition;familyId:string;childId:string;parent:boolean;resolveFile?:typeof requestHistoryFile}){
 return <section className="olympiad-section olympiad-history" aria-label="Мои участия и работы"><h2>Мои участия и работы</h2>
  <p>Прошлые сезоны, результаты этапов и сохранённые работы.</p>
  {[...competition.seasons].sort((a,b)=>a.id==='unknown'?1:b.id==='unknown'?-1:b.id.localeCompare(a.id)).map(season=><details key={season.id} className="olympiad-history-season"><summary><strong>{season.label}</strong><span>{season.grade?`${season.grade} класс`:'Класс не установлен'}</span></summary>
   {season.stages.map(stage=><Stage key={stage.id} stage={stage} familyId={familyId} childId={childId} parent={parent} resolveFile={resolveFile}/>)}
  </details>)}
 </section>
}
