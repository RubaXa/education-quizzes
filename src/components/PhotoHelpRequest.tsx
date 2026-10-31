/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
import type { FormEvent, ReactNode } from 'react'
import PhotoUploadControl from './PhotoUploadControl'
import ReviewBrief from './ReviewBrief'
import './ProblemStatement.css'
import './ProblemCard.css'

/** Photo-based help composition; the caller owns selection, submission and access.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств
 * @see ../../docs/decisions/ui-kit-photo-help-2026-10-27.md */
export default function PhotoHelpRequest({ photos, selectedCount, note, onNote, onPhotos, onSubmit, status, response, previousResponse, parent = false, onOpenChange, attachedDescription }: {
  photos: ReactNode
  selectedCount: number
  note: string
  onNote: (value: string) => void
  onPhotos: (files: File[]) => void
  onSubmit: () => void
  status: 'draft' | 'pending' | 'ready'
  response?: string
  previousResponse?: string
  parent?: boolean
  onOpenChange?: (open: boolean) => void
  attachedDescription?: string
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parent && (selectedCount > 0 || status === 'pending' && note.trim())) onSubmit()
  }
  return <>{photos}{(!parent || status !== 'draft') && <details className="problem-statement-help" onToggle={event => { if (event.target === event.currentTarget) onOpenChange?.(event.currentTarget.open) }}>
    <summary>Нужен ориентир?</summary>
    <form onSubmit={submit}>
      {!parent && <p>Выбери в галерее выше или добавь фото того, что ты записал или попробовал. Не бойся присылать зачёркнутое: я постараюсь разобраться, показать, где ты двигался верно, и объяснить следующий шаг.</p>}
      {status === 'pending' && <p role="status"><strong>Помощь запрошена</strong> · ждём ответ</p>}
      {response && <ReviewBrief data={{id:response,label:'Следующий шаг',status:'neutral',body:response,details:previousResponse?[{label:'Предыдущая помощь',text:previousResponse}]:[]}} />}
      {parent && attachedDescription && <p>Фото запроса: {attachedDescription}</p>}
      {!parent && <>
        <PhotoUploadControl className="problem-card-upload" label="Добавить фото записей" onPhotos={onPhotos} />
        <p>Выбрано фото: {selectedCount}. {status === 'pending' ? 'Можно добавить фото или пояснение.' : 'Для запроса нужно хотя бы одно фото.'}</p>
        <label className="problem-statement-help-note">Вопрос или пояснение (необязательно)<textarea value={note} onChange={event => onNote(event.currentTarget.value)} maxLength={800} placeholder="Моя мысль или вопрос" /></label>
        <button className="problem-statement-help-button" type="submit" disabled={selectedCount === 0 && !(status === 'pending' && note.trim())}>{status === 'pending' ? 'Добавить к запросу' : status === 'ready' ? 'Продолжить запрос' : 'Попросить помощь'}</button>
      </>}
      {parent && <p>{note ? `Вопрос ученика: ${note}` : 'Вопрос без текста'}</p>}
    </form>
  </details>}</>
}
