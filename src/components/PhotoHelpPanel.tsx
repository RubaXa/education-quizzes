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
export default function PhotoHelpPanel({ studentToken, taskId, parent, canRequest, canRead = true, uploads, help, guidance, gallery }: {
  studentToken: string; taskId: string; parent: boolean; canRequest: boolean; canRead?: boolean; uploads: DayUpload[]; help?: DayHelp; guidance: DayGuidance[];
  gallery: (selection?: WorkPhotoSelection) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<DayHelp[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<string | null>(null)
  const responses = guidance.filter(item => item.stageId === 'help-response' && !item.reviewResponse)
  const currentAnswered = help?.eventReceiptId && responses.some(item => item.sourceRequestEventId === help.eventReceiptId)
  const previouslyUsed = new Set(currentAnswered ? (help?.photoUploadIds ?? []).map(id => `${studentToken}:${id}`) : [])
  const eligible = uploads.filter(photo => photo.id.startsWith(`${studentToken}:`) && photo.taskId === taskId && ['pending', 'reviewed'].includes(photo.status) && photo.storage?.state === 'stored' && !previouslyUsed.has(photo.id))
  const eligibleIds = new Set(eligible.map(photo => photo.id))
  const chosen = selected.filter(id => eligibleIds.has(id))
  const latest = responses.at(-1)
  const role = parent ? 'parent' : 'student'
  const attachedNumbers = (help?.photoUploadIds ?? []).map(id => uploads.filter(photo => photo.id.startsWith(`${studentToken}:`)).findIndex(photo => photo.id === `${studentToken}:${id}`) + 1).filter(index => index > 0)
  useEffect(() => { if (latest) tracePhotoHelp('answer-ready', 'product', role) }, [latest?.id, role])
  useEffect(() => { if (!canRead || !canRequest && !parent) return; return watchDayHelpHistory(studentToken, taskId, setHistory, () => setError('Не удалось загрузить историю помощи.')) }, [studentToken, taskId, canRequest, canRead, parent])
  async function submit() {
    const ids = chosen.length ? chosen.map(id => id.slice(studentToken.length + 1)) : !currentAnswered && note.trim() ? help?.photoUploadIds ?? [] : []
    if (!ids.length || pending || !canRequest) return
    setPending(true); setError(''); tracePhotoHelp('waiting', 'product', role, { count: ids.length, hasNote: Boolean(note.trim()) })
    operation.current ??= crypto.randomUUID()
    try {
      await requestDayHelp(studentToken, taskId, help?.revision ?? 1, 'step', note, { photoUploadIds: ids, operationId: operation.current })
      tracePhotoHelp('submitted', 'product', role, { count: ids.length, hasNote: Boolean(note.trim()) }); operation.current = null; setSelected([]); setNote('')
    } catch (cause) { tracePhotoHelp('failed', 'product', role, { code: 'submit-failed' }); setError(reportUiError(cause, 'Запрос помощи')) }
    finally { setPending(false) }
  }
  return <>
    {gallery(!parent && open ? { selectedIds: chosen, onChange: ids => { operation.current = null; setSelected(ids); tracePhotoHelp('selection-changed', 'product', role, { count: ids.length }) }, isSelectable: id => eligibleIds.has(id) } : undefined)}
    {(canRequest || parent && help?.photoUploadIds?.length) && <details className="problem-statement-help" onToggle={event => { const next = event.currentTarget.open; setOpen(next); tracePhotoHelp(next ? 'opened' : 'closed', 'product', role); if (next && latest) tracePhotoHelp('answer-opened', 'product', role) }}>
      <summary>Нужна помощь?</summary>
      {!parent && <p>Выбери в галерее фото того, что ты записал или попробовал. Не бойся присылать зачёркнутое: я постараюсь разобраться, показать, где ты двигался верно, и объяснить следующий шаг.</p>}
      {help?.photoUploadIds?.length && !currentAnswered && <p role="status">Помощь запрошена · ждём ответ</p>}
      {parent && help?.photoUploadIds?.length && <p>Фото в запросе: {help.photoUploadIds.length}{attachedNumbers.length ? ` (в галерее: ${attachedNumbers.join(', ')})` : ''}. {help.requestText ? `Вопрос: ${help.requestText}` : 'Вопрос без текста.'}</p>}
      {latest && <div className="problem-statement-help-result"><strong>Следующий шаг</strong><p>{latest.text}</p>{responses.length > 1 && <details><summary>Предыдущая помощь</summary>{responses.slice(0, -1).map(item => <p key={item.id}>{item.text}</p>)}</details>}</div>}
      {history.length > 0 && <details><summary>История запросов ({history.length})</summary>{history.filter(item=>!item.reviewReply).slice().sort((a, b) => ((a.requestedAt as { seconds?: number })?.seconds ?? 0) - ((b.requestedAt as { seconds?: number })?.seconds ?? 0)).map(item => <div key={item.id}><p>Фото: {(item.photoUploadIds ?? []).map(id => uploads.filter(photo => photo.id.startsWith(`${studentToken}:`)).findIndex(photo => photo.id === `${studentToken}:${id}`) + 1).filter(index => index > 0).join(', ') || 'недоступны'}. {item.requestText || 'Без пояснения.'}</p>{guidance.filter(answer => answer.sourceRequestEventId === item.eventReceiptId).map(answer => <p key={answer.id}>{answer.text}</p>)}</div>)}</details>}
      {!parent && <><p>Выбрано фото: {chosen.length}. {currentAnswered ? 'Для продолжения добавь фото нового шага.' : 'Для запроса нужно хотя бы одно сохранённое фото. Добавить фото можно кнопкой загрузки выше.'}</p>
        <label className="problem-statement-help-note">Вопрос или пояснение (необязательно)<textarea value={note} maxLength={800} onChange={event => { operation.current = null; setNote(event.currentTarget.value) }} /></label>
        <button type="button" className="problem-statement-help-button" disabled={pending || !chosen.length && !(help?.photoUploadIds?.length && !currentAnswered && note.trim())} onClick={() => void submit()}>{pending ? 'Отправляем…' : help?.photoUploadIds?.length ? 'Продолжить запрос' : 'Попросить помощь'}</button></>}
      {error && <p className="problem-statement-error" role="alert">{error}</p>}
    </details>}
  </>
}
