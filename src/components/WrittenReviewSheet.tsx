/** @see ../../docs/decisions/archive-and-compact-written-review-2026-11-27.md */
/** @see ../../docs/modules/reviews/marked-work-sheet.md */
import {useId,useRef,useState} from 'react'
import {Check, CircleHelp, Pencil, CheckCheck, X, ChevronDown} from 'lucide-react'
import type {DayUpload,DayWorkReview} from '@/lib/dayStore'
import {markedWorkSheetValid,type MarkedWorkSheet,type WorkSheetMark} from '../../packages/education-presentation/marked-work-sheet.mjs'
import {WorkArtifactImage,WorkUploadTime} from './ArtifactAvatar'
import {useViewChoices} from '@/lib/useViewChoices'
import './WrittenReviewSheet.css'

const labels={correct:'Верно',incorrect:'Нужна правка',partial:'Часть верна',unreadable:'Уточнить запись',corrected:'Исправление принято'}
const icons={correct:Check,incorrect:Pencil,partial:Pencil,unreadable:CircleHelp,corrected:CheckCheck}
type Snapshot=Pick<DayWorkReview,'studentFeedback'|'uploadIds'|'checkedAt'>
function content(review:Snapshot):{sheet:MarkedWorkSheet;fragments:boolean}|undefined{
 const sheet=review.studentFeedback?.presentation?.sheet
 if(markedWorkSheetValid(sheet))return {sheet,fragments:false}
 const steps=review.studentFeedback?.steps?.filter(s=>s.observation?.trim())??[]
 if(!steps.length)return
 return {fragments:true,sheet:{version:1,title:'Распознанные фрагменты',blocks:steps.map((s,i)=>({id:`fragment-${i}`,uploadId:s.uploadId,location:s.location,parts:[{text:s.observation,mark:{id:`mark-${i}`,status:s.status==='correct'?'correct':s.status==='incorrect'?'incorrect':s.status==='partial'?'partial':'unreadable',comment:s.explanation||s.location}}]}))}}
}

/** Pure view of supplied public facts. No grading or new database reads. */
export default function WrittenReviewSheet({review,uploads,parent=false}:{review:DayWorkReview;uploads:DayUpload[];parent?:boolean}){
 const [attempt,setAttempt]=useState('current'),[view,setView]=useState<'sheet'|'original'>('sheet'),[selected,setSelected]=useState<string>()
 const {choices,choose}=useViewChoices(`written:${parent?'parent':'student'}:${review.id}:${review.taskId}`)
 const expanded=choices.expanded??true
 const trigger=useRef<HTMLButtonElement|null>(null)
 const uid=useId(),history=review.history??[],snapshot=attempt==='current'?review:history[Number(attempt)]??review
 const data=content(snapshot),ids=new Set(snapshot.uploadIds??[]),availableHistory=history.map((entry,i)=>({entry,i})).filter(({entry})=>content(entry)||entry.uploadIds?.length)
 for(const b of data?.sheet.blocks??[])ids.add(b.uploadId)
 const files=uploads.filter(u=>ids.has(u.id)||ids.has(u.id.split(':').at(-1)!)||attempt==='current'&&(u.taskId===review.taskId||u.coveredTaskIds?.includes(review.taskId)))
 if(!data&&!files.length)return null
 const reset=(value:string)=>{setAttempt(value);setSelected(undefined)}
 return <section className="edu-written-sheet" aria-label="Лист письменной работы">
  <button type="button" className="edu-written-toggle" aria-expanded={expanded} aria-controls={`${uid}-content`} onClick={()=>choose('expanded',!expanded)}><strong>Проверка работы</strong><ChevronDown size={18} aria-hidden="true"/></button>
  <div className="edu-written-content" id={`${uid}-content`} hidden={!expanded}>
  <div className="edu-written-tools">
   <div className="edu-written-tabs" role="group" aria-label="Вид письменной работы">
    <button type="button" aria-pressed={view==='sheet'} onClick={()=>setView('sheet')}>Разбор</button>
    <button type="button" aria-pressed={view==='original'} onClick={()=>setView('original')}>Оригиналы · {files.length}</button>
   </div>
   {!!availableHistory.length&&<label>Проверка<select value={attempt} onChange={e=>reset(e.target.value)}><option value="current">Текущая</option>{availableHistory.map(({i})=><option key={i} value={String(i)}>Предыдущая · {i+1}</option>)}</select></label>}
  </div>
  {attempt!=='current'&&<p className="edu-written-history-label">Предыдущая проверка. Текущий результат задания сохранён.</p>}
  {view==='sheet'?(data?<article className="edu-written-paper" aria-label={data.sheet.title}>
   <header><h4>{data.sheet.title}</h4><p>{data.fragments?'Сохранённые фрагменты разбора; полной расшифровки пока нет.':'Твоя запись, как она прочитана на фото'}</p></header>
   {data.sheet.blocks.map((block,bi)=>{
    const active=block.parts.find(p=>p.mark?.id===selected)?.mark
    const commentId=`${uid}-comment-${bi}`
    return <section key={block.id} className="edu-written-block" aria-label={block.location}>
     <p className="edu-written-location">{block.location}</p>
     <p className="edu-written-line">{block.parts.map((part,pi)=>{if(!part.mark)return <span key={pi}>{part.text}</span>
      const mark=part.mark,Icon=icons[mark.status]
      return <button key={pi} type="button" className={`edu-written-mark ${mark.status}`} aria-label={`${part.text} — ${labels[mark.status]}. Пояснение`} aria-expanded={selected===mark.id} aria-controls={commentId} onClick={event=>{trigger.current=event.currentTarget;setSelected(selected===mark.id?undefined:mark.id)}}><span>{part.text}</span><Icon size={15} aria-hidden="true"/></button>
     })}</p>
     {active&&<MarkComment mark={active} id={commentId} onClose={()=>{setSelected(undefined);trigger.current?.focus()}}/>}
    </section>
   })}
   <p className="edu-written-legend"><Check size={15} aria-hidden="true"/> Верно <Pencil size={15} aria-hidden="true"/> Есть пометка · нажми для пояснения</p>
  </article>:<p className="edu-written-empty">Расшифровка ещё не подготовлена. Сохранённые файлы доступны во вкладке «Оригиналы»; повторно отправлять их не нужно.</p>):<div className="edu-written-originals">
   {files.map((file,i)=><figure key={file.id}><WorkArtifactImage upload={file} title={data?.sheet.title??'Письменная работа'} index={i}/><figcaption><WorkUploadTime upload={file}/>{file.storage?.publicUrl&&<a href={file.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть оригинал</a>}</figcaption></figure>)}
   {!files.length&&<p>Ссылка на оригинал пока недоступна в этой карточке. Сохранённый разбор остаётся на месте.</p>}
  </div>}
  </div>
 </section>
}
function MarkComment({mark,id,onClose}:{mark:WorkSheetMark;id:string;onClose:()=>void}){
 const Icon=icons[mark.status]
 return <aside className={`edu-written-comment ${mark.status}`} id={id} role="note" aria-live="polite"><div><Icon size={17} aria-hidden="true"/><strong>{labels[mark.status]}</strong><button type="button" aria-label="Закрыть пояснение" onClick={onClose}><X size={17}/></button></div><p>{mark.comment}</p></aside>
}
