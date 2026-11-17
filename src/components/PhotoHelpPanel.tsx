/** @see ../../docs/decisions/adaptive-review-modes-2026-11-17.md */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DayHelp, DayUpload } from '@/lib/dayStore'
import type { DayGuidance } from '@/lib/dayGuidance'
import { requestDayHelp, watchDayHelpHistory } from '@/lib/dayStore'
import { tracePhotoHelp } from '@/lib/browserAccessTrace'
import { reportUiError } from '@/lib/uiErrors'
import type { WorkPhotoSelection } from './WorkPhotoGallery'
import './ProblemStatement.css'

/** Uses the task's existing gallery and the shared dayHelp event pipeline.
 * @see ../../docs/modules/assessments/olympiad-preparation.md */
export default function PhotoHelpPanel({ studentToken, taskId, parent, canRequest, canRead = true, uploads, help, guidance, gallery, onRequest=requestDayHelp,familyDecision,onFamilyDecision }: {
  studentToken: string; taskId: string; parent: boolean; canRequest: boolean; canRead?: boolean; uploads: DayUpload[]; help?: DayHelp; guidance: DayGuidance[];
  onRequest?:typeof requestDayHelp;familyDecision?:boolean;onFamilyDecision?:(required:boolean,operationId:string)=>Promise<void>;
  gallery: (selection?: WorkPhotoSelection) => ReactNode
}) {
  const [selectedMode,setMode]=useState<'photo'|'condition'>()
  const mode=selectedMode??(help?.requestKind==='condition'?'condition':'photo')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<DayHelp[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<string | null>(null)
  const familyOperation=useRef<{required:boolean;id:string}|null>(null)
  const [savedFamily,setSavedFamily]=useState<boolean>()
  const familyChoice=familyDecision??savedFamily
  const responses = guidance.filter(item => item.stageId === 'help-response' && !item.reviewResponse)
  const currentAnswered = help?.eventReceiptId && responses.some(item => item.sourceRequestEventId === help.eventReceiptId)
  const previouslyUsed = new Set(currentAnswered ? (help?.photoUploadIds ?? []).map(id => `${studentToken}:${id}`) : [])
  const eligible = uploads.filter(photo => photo.id.startsWith(`${studentToken}:`) && photo.taskId === taskId && ['pending', 'reviewed'].includes(photo.status) && photo.storage?.state === 'stored' && !previouslyUsed.has(photo.id))
  const eligibleIds = new Set(eligible.map(photo => photo.id))
  const chosen = selected.filter(id => eligibleIds.has(id))
  const latest=help?.eventReceiptId?responses.find(r=>r.sourceRequestEventId===help.eventReceiptId):responses.at(-1)
  const role = parent ? 'parent' : 'student'
  const attachedNumbers = (help?.photoUploadIds ?? []).map(id => uploads.filter(photo => photo.id.startsWith(`${studentToken}:`)).findIndex(photo => photo.id === `${studentToken}:${id}`) + 1).filter(index => index > 0)
  const latestId=latest?.id
  useEffect(() => { if (latestId) tracePhotoHelp('answer-ready', 'product', role) }, [latestId, role])
  useEffect(() => { if (!canRead || !canRequest && !parent) return; return watchDayHelpHistory(studentToken, taskId, setHistory, () => setError('Не удалось загрузить историю помощи.')) }, [studentToken, taskId, canRequest, canRead, parent])
  async function submit() {
    const ids = chosen.length ? chosen.map(id => id.slice(studentToken.length + 1)) : !currentAnswered && note.trim() ? help?.photoUploadIds ?? [] : []
    if ((mode==='photo'?!ids.length:!note.trim()) || pending || !canRequest) return
    setPending(true); setError(''); tracePhotoHelp('waiting', 'product', role, { count: ids.length, hasNote: Boolean(note.trim()) })
    operation.current ??= crypto.randomUUID()
    try {
      await onRequest(studentToken, taskId, help?.revision ?? 1, mode==='condition'?'condition':'step', note, mode==='condition'?{operationId:operation.current}:{ photoUploadIds: ids, operationId: operation.current })
      tracePhotoHelp('submitted', 'product', role, { count: ids.length, hasNote: Boolean(note.trim()) }); operation.current = null; setSelected([]); setNote('')
    } catch (cause) { tracePhotoHelp('failed', 'product', role, { code: 'submit-failed' }); setError(reportUiError(cause, 'Запрос помощи')) }
    finally { setPending(false) }
  }
  async function decideFamily(required:boolean){
    if(!parent||!onFamilyDecision||pending)return
    if(familyOperation.current?.required!==required)familyOperation.current={required,id:crypto.randomUUID()}
    setPending(true);setError('')
    try{await onFamilyDecision(required,familyOperation.current.id);setSavedFamily(required);familyOperation.current=null}
    catch{setError('Не удалось сохранить решение. Повтори отправку.')}
    finally{setPending(false)}
  }
  function changeSelection(ids:string[]){operation.current=null;setSelected(ids);tracePhotoHelp('selection-changed','product',role,{count:ids.length})}
  return <>
    {gallery(!parent && open && mode==='photo' ? { selectedIds: chosen, onChange: changeSelection, isSelectable: id => eligibleIds.has(id) } : undefined)}
    {(canRequest || parent && help && !help.reviewReply) && <details className="problem-statement-help" data-presentation-contract={mode==='condition'?'assignment-clarification':undefined} data-decision-nodes={mode==='condition'?'learner.context family.requirement':undefined} data-decision-edges={mode==='condition'?'component:context context:clarification clarification:family family:component':undefined} onToggle={event => { const next = event.currentTarget.open; setOpen(next); tracePhotoHelp(next ? 'opened' : 'closed', 'product', role); if (next && latest) tracePhotoHelp('answer-opened', 'product', role) }}>
      <summary>Нужна помощь?</summary>
      {!parent&&<div className="problem-statement-help-modes" role="group" aria-label="О чём спросить"><button type="button" className="problem-statement-help-button" aria-pressed={mode==='photo'} onClick={()=>{setMode('photo');operation.current=null}}>Помощь по работе</button><button type="button" className="problem-statement-help-button" aria-pressed={mode==='condition'} onClick={()=>{setMode('condition');operation.current=null}}>Уточнить задание</button></div>}
      {!parent && mode==='photo' && <p>Выбери в галерее фото того, что ты записал или попробовал. Не бойся присылать зачёркнутое: я постараюсь разобраться, показать, где ты двигался верно, и объяснить следующий шаг.</p>}
      {help&&!help.reviewReply&&help.eventReceiptId&&!currentAnswered&& <p role="status">Помощь запрошена · ждём ответ</p>}
      {parent&&help?.requestKind==='condition'&&<p>Уточнение ребёнка: {help.requestText}</p>}
      {parent && help?.photoUploadIds?.length && <p>Фото в запросе: {help.photoUploadIds.length}{attachedNumbers.length ? ` (в галерее: ${attachedNumbers.join(', ')})` : ''}. {help.requestText ? `Вопрос: ${help.requestText}` : 'Вопрос без текста.'}</p>}
      {latest && <div className="problem-statement-help-result"><strong>{latest.clarification==='ask-parent'?familyChoice===undefined?'Нужно решение родителя':'Семейный выбор сохранён':latest.clarification==='ask-child'?'Уточним задание':'Следующий шаг'}</strong>
        {latest.clarification==='ask-parent'&&familyChoice!==undefined?<><p>{familyChoice?'Семья оставила задание обязательным.':'Семья исключила задание из обязательного плана. Назначение учителя и работа сохранены.'}</p><details><summary>Почему уточняли</summary><p>{latest.text}</p></details></>:<p>{latest.text}</p>}
        {parent&&latest.clarification==='ask-parent'&&familyChoice===undefined&&onFamilyDecision&&<div className="problem-statement-help-modes">{([[true,'Оставить обязательным'],[false,'Исключить из семейного плана']] as const).map(([required,label])=><button type="button" className="problem-statement-help-button" key={label} disabled={pending} onClick={()=>void decideFamily(required)}>{label}</button>)}</div>}{responses.length > 1 && <details><summary>Предыдущая помощь</summary>{responses.slice(0, -1).map(item => <p key={item.id}>{item.text}</p>)}</details>}</div>}
      {history.length > 0 && <details><summary>История запросов ({history.length})</summary>{history.filter(item=>!item.reviewReply).slice().sort((a, b) => ((a.requestedAt as { seconds?: number })?.seconds ?? 0) - ((b.requestedAt as { seconds?: number })?.seconds ?? 0)).map(item => <div key={item.id}><p>{item.photoUploadIds?.length?'Фото: ':''}{(item.photoUploadIds ?? []).map(id => uploads.filter(photo => photo.id.startsWith(`${studentToken}:`)).findIndex(photo => photo.id === `${studentToken}:${id}`) + 1).filter(index => index > 0).join(', ')}. {item.requestText || 'Без пояснения.'}</p>{guidance.filter(answer => answer.sourceRequestEventId === item.eventReceiptId).map(answer => <p key={answer.id}>{answer.text}</p>)}</div>)}</details>}
      {!parent && <>{mode==='photo'?<p>Выбрано фото: {chosen.length}. {currentAnswered ? 'Для продолжения добавь фото нового шага.' : 'Для запроса нужно хотя бы одно сохранённое фото. Добавить фото можно кнопкой загрузки выше.'}</p>:<p>Расскажи, что сказал учитель и что здесь не совпадает. Уже загруженное повторно присылать не нужно. Мы сверим источники; если останется противоречие, решение примет родитель.</p>}
        <label className="problem-statement-help-note">{mode==='condition'?'Что нужно уточнить?':'Вопрос или пояснение (необязательно)'}<textarea value={note} maxLength={800} onChange={event => { operation.current = null; setNote(event.currentTarget.value) }} /></label>
        <button type="button" data-help-action="submit" className="problem-statement-help-button" disabled={pending || (mode==='condition'?!note.trim():!chosen.length && !(help?.photoUploadIds?.length && !currentAnswered && note.trim()))} onClick={() => void submit()}>{pending ? 'Отправляем…' : mode==='condition'?'Отправить уточнение':help?.photoUploadIds?.length ? 'Продолжить запрос' : 'Попросить помощь'}</button></>}
      {error && <p className="problem-statement-error" role="alert">{error}</p>}
    </details>}
  </>
}
