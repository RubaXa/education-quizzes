import { useCallback, useEffect, useRef, useState } from 'react'
import { olympiadRequest } from '@/lib/olympiad/client'
import { olympiadPhoto } from '@/lib/olympiad/photoClient'
import { tracePhotoHelp } from '@/lib/browserAccessTrace'
import type { DayUpload } from '@/lib/dayStore'
import { ProblemCard, ProblemUploadButton } from './ProblemCard'
import ProblemStatement from './ProblemStatement'
import PhotoHelpRequest from './PhotoHelpRequest'
import WorkPhotoGallery from './WorkPhotoGallery'

/** One gallery for written evidence and photo-based help; server authorizes every projection.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств */
type Scope = { familyId:string; childId:string; olympiadId:string; problemId:string }
type Problem = { id:string; title:string; statement:string }
type Help = { status:'requested'|'processing'|'answered'; revision:number; revisions:{revision:number;photoIds:string[];note:string}[]; answers:{revision:number;text:string}[] }
type HelpList = { photos:{id:string}[]; requests:{requestId:string;status:string;revision:number}[] }
export default function OlympiadWrittenPractice({ scope, problem, number, parent, diagnosticsContext='product', request=olympiadRequest, photo=olympiadPhoto }: { scope:Scope; problem:Problem; number:number; parent:boolean; diagnosticsContext?:'demo'|'product'; request?:typeof olympiadRequest; photo?:typeof olympiadPhoto }) {
  const [uploads,setUploads]=useState<DayUpload[]>([]), [selected,setSelected]=useState<string[]>([]), [open,setOpen]=useState(false)
  const [requests,setRequests]=useState<{requestId:string;detail:Help}[]>([]), [note,setNote]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const urls=useRef<string[]>([]), lock=useRef(false), nextRequest=useRef<string | undefined>(undefined), operation=useRef<{id:string;photoIds:string[];note:string} | undefined>(undefined)
  const role=parent?'parent':'student'
  const {familyId,childId,olympiadId,problemId}=scope
  const generation=useRef(0), now=useRef(Date.now())
  const refresh=useCallback(async()=>{
    const currentGeneration=generation.current, currentScope={familyId,childId,olympiadId,problemId}, created:string[]=[]
    const list=await request<HelpList>({action:'list-help',scope:currentScope})
    const [details,images]=await Promise.all([Promise.all(list.requests.map(async item=>({requestId:item.requestId,detail:await request<Help>({action:'read-help',request:{...currentScope,requestId:item.requestId}})}))),Promise.all(list.photos.map(async item=>{
      try { const result=await photo('photo-read',{...currentScope,photoId:item.id}); if (!(result instanceof Blob)) return null; const url=URL.createObjectURL(result); created.push(url); return {id:item.id,taskId:problem.id,status:'pending' as const,dataUrl:url} }
      catch { return {id:item.id,taskId:problem.id,status:'upload-error' as const,error:'Не удалось открыть фото.'} }
    }))])
    if(currentGeneration!==generation.current){created.forEach(URL.revokeObjectURL);return}
    urls.current.forEach(URL.revokeObjectURL);urls.current=created
    setRequests(details);setUploads(images.filter((item):item is NonNullable<typeof item>=>item!==null))
  },[request,photo,familyId,childId,olympiadId,problemId,problem.id])
  useEffect(()=>{let active=true; void refresh().catch(()=>{if(active)setError('Не удалось загрузить фотографии и запросы помощи.')}); return ()=>{active=false;generation.current++;urls.current.forEach(URL.revokeObjectURL);urls.current=[]}},[refresh])
  const latest=requests.at(-1), detail=latest?.detail, status=detail?.status==='answered'?'ready':detail?'pending':'draft'
  const submitted=new Set(detail?.revisions.flatMap(r=>r.photoIds) ?? [])
  async function addPhotos(files:File[]) {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try { for(const file of files) { const receiptId=crypto.randomUUID(); await photo('photo-upload',{...scope,receiptId,mime:file.type},file); tracePhotoHelp('photos-added',diagnosticsContext,role,{count:1}) } await refresh() }
    catch { setError('Не удалось сохранить фото. Попробуй загрузить его снова.');tracePhotoHelp('failed',diagnosticsContext,role,{code:'upload-failed'});await refresh().catch(()=>{}) }
    finally {lock.current=false;setBusy(false)}
  }
  async function submit() {
    if(lock.current || busy)return
    lock.current=true;setBusy(true);setError('')
    const requestId=latest?.requestId ?? (nextRequest.current ??= crypto.randomUUID())
    const current=operation.current ?? {id:crypto.randomUUID(),photoIds:selected,note};operation.current=current
    if(current.note!==note || JSON.stringify(current.photoIds)!==JSON.stringify(selected)){setError('Верни прежний выбор и текст, чтобы повторить отправку.');lock.current=false;setBusy(false);return}
    try { await request({action:'submit-help',request:{...scope,requestId,operationId:current.id,photoIds:current.photoIds,note:current.note}}); operation.current=undefined;setSelected([]);setNote('');await refresh();tracePhotoHelp('submitted',diagnosticsContext,role,{count:current.photoIds.length,hasNote:!!current.note.trim()}) }
    catch {setError('Не удалось отправить запрос. Повтори отправку.');tracePhotoHelp('failed',diagnosticsContext,role,{code:'submit-failed'})}
    finally {lock.current=false;setBusy(false)}
  }
  const cardProblem={id:problem.id,number,title:problem.title,detail:problem.statement,source:'Подготовительная задача',original:{text:problem.statement,attachmentRef:''}}
  return <ProblemCard problem={cardProblem} state={{label:'Для практики',tone:'ready'}} parent={parent}>
    <ProblemStatement problem={cardProblem} links={[]} parent={parent} />
    {!parent && <ProblemUploadButton correction={false} onPhotos={files=>void addPhotos(files)} />}
    <p>Фото сохраняются для помощи. Отдельная проверка письменного решения пока недоступна.</p>
    <PhotoHelpRequest parent={parent} status={status} selectedCount={selected.length} note={parent ? detail?.revisions.at(-1)?.note ?? '' : note} onNote={setNote} onPhotos={files=>void addPhotos(files)} onSubmit={()=>void submit()} onOpenChange={value=>{setOpen(value);tracePhotoHelp(value?'opened':'closed',diagnosticsContext,role);if(value && detail?.answers.length)tracePhotoHelp('answer-opened',diagnosticsContext,role)}}
      response={detail?.answers.at(-1)?.text} previousResponse={detail?.answers.length && detail.answers.length>1 ? detail.answers.at(-2)?.text : undefined}
      attachedDescription={detail?.revisions.flatMap(r=>r.photoIds).map(id=>`Фото ${uploads.findIndex(item=>item.id===id)+1}`).join(', ')}
      photos={<WorkPhotoGallery purpose="help" taskTitle={problem.title} studentToken="olympiad" uploads={uploads} localPhotos={[]} now={now.current} evidenceLabel={!parent && open?'Выбери фото для помощи':'Фото работы'} selection={!parent && open ? {selectedIds:selected,onChange:ids=>{setSelected(ids);tracePhotoHelp('selection-changed',diagnosticsContext,role,{count:ids.length})},isSelectable:id=>uploads.find(item=>item.id===id)?.status!=='upload-error' && (status!=='ready'||!submitted.has(id))}:undefined} />}/>
    {detail && <details><summary>История запроса помощи</summary>{detail.revisions.map(revision=><div key={revision.revision}><strong>Дополнение {revision.revision}</strong><p>{revision.note || 'Без текстового вопроса'}</p><p>Фото: {revision.photoIds.map(id=>{const index=uploads.findIndex(item=>item.id===id);return index>=0?String(index+1):'недоступно'}).join(', ') || 'нет новых фото'}</p>{detail.answers.filter(answer=>answer.revision===revision.revision).map(answer=><p key={answer.revision}>{answer.text}</p>)}</div>)}</details>}
    {busy && <p role="status">Сохраняем…</p>}{error && <p role="alert">{error}</p>}
    {detail && <button type="button" className="problem-statement-help-button" onClick={()=>void refresh().catch(()=>setError('Не удалось обновить помощь.'))}>Обновить ответ</button>}
  </ProblemCard>
}
