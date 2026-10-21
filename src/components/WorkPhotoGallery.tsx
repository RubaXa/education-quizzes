/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md */
/* @see ../../docs/shared/design/components.md */
/* @see ../../docs/decisions/work-photo-expand-2026-10-18.md */
import { useState } from 'react'
import { ExternalLink, RotateCcw, Trash2, X } from 'lucide-react'
import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import { activeProcessing, artifactAvatarLabel, artifactAvatarState, localArtifactAvatarState } from '@/lib/reviewPresentation'
import { reportUiError } from '@/lib/uiErrors'
import EducationImage from './EducationImage'
import ArtifactAvatar, { WorkArtifactImage, WorkUploadTime, workUploadTimeLabel } from './ArtifactAvatar'
import './WorkPhotoGallery.css'

export type LocalWorkPhoto = { id: string; taskId: string; previewUrl: string; state: 'uploading' | 'saved' | 'failed' | 'deleting'; error?: string }

/**
 * Разделяет технический статус снимка и педагогический результат задания.
 * @see ../../docs/modules/school-diary/day-page.md#photo-status
 */
export default function WorkPhotoGallery<T extends LocalWorkPhoto>({ taskTitle, evidenceLabel = 'Фото работы', studentToken, uploads, localPhotos, review, now, onRetry, onDelete, compact = false }: {
  taskTitle: string; evidenceLabel?: string; studentToken: string; uploads: DayUpload[]; localPhotos: T[]; review?: DayWorkReview; now: number;
  onRetry?: (photo: T) => void; onDelete?: (uploadId: string) => Promise<void>; compact?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const visibleUploads = uploads.filter((upload) => !removedIds.includes(upload.id))
  const localOnly = localPhotos.filter((photo) => !removedIds.includes(`${studentToken}:${photo.id}`) && !visibleUploads.some((upload) => upload.id === `${studentToken}:${photo.id}`))
  if (!visibleUploads.length && !localOnly.length) return null
  const photoCount = visibleUploads.length + localOnly.length
  const reviewedCount = visibleUploads.filter((upload) => upload.status === 'reviewed').length
  const processingCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'processing').length
  const waitingCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'waiting').length
  const pausedCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'paused').length
  const uploadingCount = visibleUploads.filter((upload) => ['requested', 'awaiting-upload', 'uploaded'].includes(upload.status)).length + localOnly.filter((photo) => photo.state === 'uploading' || photo.state === 'saved').length
  const failedCount = visibleUploads.filter((upload) => upload.status === 'upload-error').length + localOnly.filter((photo) => photo.state === 'failed').length
  const summary = [processingCount && `${processingCount} в разборе`, waitingCount && `${waitingCount} ${waitingCount === 1 ? 'ждёт' : 'ждут'} проверки`, pausedCount && `${pausedCount} с задержкой проверки`, uploadingCount && `${uploadingCount} загружается`, failedCount && `${failedCount} не загрузилось`].filter(Boolean).join(' · ')
  const selectedUpload = visibleUploads.find((upload) => upload.id === selectedId)
  const selectedLocal = localOnly.find((photo) => `${studentToken}:${photo.id}` === selectedId)
  async function deletePhoto(id: string) {
    if (!onDelete || !compact && !window.confirm('Удалить это фото из задания?')) return
    setRemovingId(id)
    setDeleteError('')
    try {
      await onDelete(id)
      setRemovedIds((current) => [...current, id])
      setSelectedId(null)
    } catch (cause) {
      setDeleteError(reportUiError(cause, 'Удаление фото'))
    } finally {
      setRemovingId(null)
    }
  }
  const cdzProof = evidenceLabel === 'Подтверждение ЦДЗ'
  return <div className={`day-upload-list${compact ? ' work-photo-gallery-compact' : ''}`} aria-label={`Фото задания «${taskTitle}»`}>
    {!compact && <div className="day-upload-head"><strong>{evidenceLabel}</strong><span>{reviewedCount} из {photoCount} фото проверено</span></div>}
    {cdzProof && <small className="day-upload-context">Снимок результата МЭШ, присланный ребёнком. Кнопки внутри снимка относятся к МЭШ.</small>}
    <div className={`day-upload-strip${compact ? ' weekend-math-photos' : ''}`}>
      {visibleUploads.map((upload, index) => {
        const state = artifactAvatarState(upload, review, now)
        const status = artifactAvatarLabel(state)
        const photoLabel = `${upload.origin === 'archive' ? `Фото из архива ${index + 1}` : `Фото ${index + 1}`} · ${status} · ${workUploadTimeLabel(upload)}`
        const thumbnail = <button className="day-upload-chip" type="button" key={upload.id} title={photoLabel} aria-label={`Открыть ${photoLabel}`} aria-expanded={selectedId === upload.id} onClick={() => setSelectedId(selectedId === upload.id ? null : upload.id)}><ArtifactAvatar state={state}><WorkArtifactImage upload={upload} title={taskTitle} index={index} fallbackUrl={localPhotos.find((photo) => upload.id === `${studentToken}:${photo.id}`)?.previewUrl} compact retryControl={false} /></ArtifactAvatar></button>
        return compact ? <span className="weekend-math-photo-item" key={upload.id}>{thumbnail}{onDelete && upload.status !== 'reviewed' && <button type="button" className="weekend-math-photo-delete" aria-label={`Удалить фото ${index + 1}`} disabled={removingId === upload.id} onClick={() => void deletePhoto(upload.id)}><X size={11} aria-hidden="true" /></button>}</span> : thumbnail
      })}
      {localOnly.map((photo, index) => {
        const id = `${studentToken}:${photo.id}`
        const state = localArtifactAvatarState(photo.state)
        const status = artifactAvatarLabel(state)
        const photoLabel = `Фото ${visibleUploads.length + index + 1} · ${status} · Время загрузки появится после передачи фото`
        const thumbnail = <button className="day-upload-chip" type="button" key={photo.id} title={photoLabel} aria-label={`Открыть ${photoLabel}`} aria-expanded={selectedId === id} onClick={() => setSelectedId(selectedId === id ? null : id)}><ArtifactAvatar state={state}><EducationImage source={photo.previewUrl} alt="" compact retryControl={false} /></ArtifactAvatar></button>
        return compact ? <span className="weekend-math-photo-item" key={photo.id}>{thumbnail}</span> : thumbnail
      })}
    </div>
    {!compact && summary && <small className="day-upload-summary">{summary}</small>}
    {(selectedUpload || selectedLocal) && <div className="day-upload-expanded"><button className="day-upload-close" type="button" aria-label="Закрыть фото" onClick={() => setSelectedId(null)}><X size={17} aria-hidden="true" /></button>
      {selectedUpload ? <><WorkArtifactImage upload={selectedUpload} title={taskTitle} index={visibleUploads.indexOf(selectedUpload)} fallbackUrl={localPhotos.find((photo) => selectedUpload.id === `${studentToken}:${photo.id}`)?.previewUrl} /><WorkUploadTime upload={selectedUpload} /><p>{selectedUpload.status === 'reviewed' ? cdzProof ? 'Результат ЦДЗ указан в карточке задания.' : review?.purpose === 'source-material' ? 'Это материал для самопроверки; наблюдения о записях показаны рядом. Фото не является результатом теста.' : 'Разбор этого задания показан в блоке «Проверка работы».' : selectedUpload.status === 'upload-error' ? selectedUpload.error ?? 'Не удалось передать фото. Удалите запись и загрузите снимок снова.' : selectedUpload.status === 'pending' ? activeProcessing(review, [selectedUpload]) ? 'Сейчас проверяем фото.' : 'Фото ждёт разбора.' : 'Исходное фото передаётся напрямую на Яндекс.Диск; дождитесь подтверждения.'} {selectedUpload.storage?.state === 'stored' ? 'Файл на Яндекс.Диске.' : 'Исходник остаётся на этом устройстве до передачи.'}</p>{selectedUpload.storage?.publicUrl && <a className="day-upload-original" href={selectedUpload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>}</>
        : selectedLocal && <><EducationImage source={selectedLocal.previewUrl} alt={`Новое фото по заданию «${taskTitle}»`} className="day-upload-photo" /><p className="work-upload-time">Время загрузки появится после передачи фото</p><p>{selectedLocal.state === 'failed' ? selectedLocal.error ?? 'Не удалось загрузить фото.' : selectedLocal.state === 'saved' ? 'Фото сохранено и ждёт разбора.' : selectedLocal.state === 'deleting' ? 'Удаляем фото…' : 'Фото загружается…'}</p>{onRetry && selectedLocal.state === 'failed' && removingId !== selectedId && <button type="button" className="day-upload-retry" onClick={() => onRetry(selectedLocal)}><RotateCcw size={14} aria-hidden="true" /> Повторить</button>}</>}
      {onDelete && (selectedUpload && selectedUpload.status !== 'reviewed' || !compact && selectedLocal) && <button className="day-upload-delete" type="button" disabled={removingId === selectedId} onClick={() => selectedId && void deletePhoto(selectedId)}><Trash2 size={14} aria-hidden="true" /> {removingId === selectedId ? 'Удаляем…' : 'Удалить фото'}</button>}
      {deleteError && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
    </div>}
    {deleteError && !selectedUpload && !selectedLocal && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
  </div>
}
