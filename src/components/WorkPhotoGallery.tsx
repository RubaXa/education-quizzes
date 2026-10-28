/** @see ../../docs/decisions/ui-kit-photo-help-2026-10-27.md */
/** @see ../../docs/decisions/work-photo-thumbnail-decomposition-2026-10-27.md */
/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md */
/** @see ../../docs/decisions/photo-transfer-recovery-2026-10-22.md */
/* @see ../../docs/shared/design/components.md */
/* @see ../../docs/decisions/work-photo-expand-2026-10-18.md */
import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Check, ExternalLink, RotateCcw, Trash2, X } from 'lucide-react'
import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import { activeProcessing, artifactAvatarLabel, artifactAvatarState, localArtifactAvatarState } from '@/lib/reviewPresentation'
import { reportUiError } from '@/lib/uiErrors'
import { getPhotoTransferUiSnapshot, photoTransferUiKey, retryPhotoTransfer, subscribePhotoTransferUi } from '@/lib/photoOutbox'
import EducationImage from './EducationImage'
import ArtifactAvatar, { WorkArtifactImage, WorkUploadTime, workUploadTimeLabel } from './ArtifactAvatar'
import './WorkPhotoGallery.css'

export type LocalWorkPhoto = { id: string; taskId: string; previewUrl: string; state: 'uploading' | 'saved' | 'failed' | 'deleting'; error?: string }

function PhotoThumbnail({ label, selected, onToggle, children, choosing = false, disabled = false }: { label: string; selected: boolean; onToggle: () => void; children: ReactNode; choosing?: boolean; disabled?: boolean }) {
  return <button className="day-upload-chip" type="button" title={label} aria-label={`${choosing ? 'Выбрать' : 'Открыть'} ${label}`} aria-expanded={choosing ? undefined : selected} aria-pressed={choosing ? selected : undefined} disabled={disabled} onClick={onToggle}>{children}{choosing && selected && <span className="day-upload-selected" aria-hidden="true"><Check size={12} /></span>}</button>
}

/** Optional controlled selection of the same gallery items; IDs are upload IDs. */
export type WorkPhotoSelection = {
  selectedIds: readonly string[]
  onChange: (selectedIds: string[]) => void
  isSelectable?: (id: string) => boolean
}

/**
 * Разделяет технический статус снимка и педагогический результат задания.
 * @see ../../docs/modules/school-diary/day-page.md#photo-status
 */
export default function WorkPhotoGallery<T extends LocalWorkPhoto>({ taskTitle, evidenceLabel = 'Фото работы', studentToken, uploads, localPhotos, review, now, onRetry, onDelete, compact = false, selection, purpose }: {
  taskTitle: string; evidenceLabel?: string; studentToken: string; uploads: DayUpload[]; localPhotos: T[]; review?: DayWorkReview; now: number;
  onRetry?: (photo: T) => void; onDelete?: (uploadId: string) => Promise<void>; compact?: boolean; selection?: WorkPhotoSelection; purpose?: 'help'
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const transferStates = useSyncExternalStore(subscribePhotoTransferUi, getPhotoTransferUiSnapshot, getPhotoTransferUiSnapshot)
  const visibleUploads = uploads.filter((upload) => !removedIds.includes(upload.id))
  const localOnly = localPhotos.filter((photo) => !removedIds.includes(`${studentToken}:${photo.id}`) && !visibleUploads.some((upload) => upload.id === `${studentToken}:${photo.id}`))
  if (!visibleUploads.length && !localOnly.length) return null
  const photoCount = visibleUploads.length + localOnly.length
  const reviewedCount = visibleUploads.filter((upload) => upload.status === 'reviewed').length
  const processingCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'processing').length
  const waitingCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'waiting').length
  const pausedCount = visibleUploads.filter((upload) => artifactAvatarState(upload, review, now) === 'paused').length
  const transferState = (upload: DayUpload) => upload.status === 'awaiting-upload' ? transferStates.get(photoTransferUiKey(upload.id)) : undefined
  const uploadingCount = visibleUploads.filter((upload) => ['requested', 'awaiting-upload', 'uploaded'].includes(upload.status)
    && transferState(upload)?.phase !== 'failed').length + localOnly.filter((photo) => photo.state === 'uploading' || photo.state === 'saved').length
  const failedCount = visibleUploads.filter((upload) => upload.status === 'upload-error' || transferState(upload)?.phase === 'failed').length + localOnly.filter((photo) => photo.state === 'failed').length
  const summary = purpose === 'help' ? `${visibleUploads.length - failedCount} сохранено для помощи${failedCount ? ` · ${failedCount} недоступно` : ''}` : [processingCount && `${processingCount} в разборе`, waitingCount && `${waitingCount} ${waitingCount === 1 ? 'ждёт' : 'ждут'} проверки`, pausedCount && `${pausedCount} с задержкой проверки`, uploadingCount && `${uploadingCount} загружается`, failedCount && `${failedCount} не загрузилось`].filter(Boolean).join(' · ')
  const selectedUpload = visibleUploads.find((upload) => upload.id === selectedId)
  const selectedTransfer = selectedUpload ? transferState(selectedUpload) : undefined
  const selectedLocal = localOnly.find((photo) => `${studentToken}:${photo.id}` === selectedId)
  function togglePhoto(id: string) {
    if (!selection) return setSelectedId(selectedId === id ? null : id)
    selection.onChange(selection.selectedIds.includes(id) ? selection.selectedIds.filter((item) => item !== id) : [...selection.selectedIds, id])
  }
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
    {!compact && <div className="day-upload-head"><strong>{evidenceLabel}</strong><span>{selection ? `Выбрано: ${selection.selectedIds.length}` : purpose === 'help' ? `${photoCount} фото` : `${reviewedCount} из ${photoCount} фото проверено`}</span></div>}
    {cdzProof && <small className="day-upload-context">Снимок результата МЭШ, присланный ребёнком. Кнопки внутри снимка относятся к МЭШ.</small>}
    <div className={`day-upload-strip${compact ? ' weekend-math-photos' : ''}`}>
      {visibleUploads.map((upload, index) => {
        const transfer = transferState(upload)
        const state = transfer?.phase === 'failed' ? 'failed' : transfer?.phase === 'sending' ? 'uploading' : artifactAvatarState(upload, review, now)
        const status = purpose === 'help' && upload.status !== 'upload-error' ? 'Сохранено для помощи' : artifactAvatarLabel(state)
        const photoLabel = `${upload.origin === 'archive' ? `Фото из архива ${index + 1}` : `Фото ${index + 1}`} · ${status} · ${workUploadTimeLabel(upload)}`
        const thumbnail = <PhotoThumbnail key={upload.id} label={photoLabel} choosing={!!selection} selected={selection ? selection.selectedIds.includes(upload.id) : selectedId === upload.id} disabled={selection?.isSelectable?.(upload.id) === false} onToggle={() => togglePhoto(upload.id)}><ArtifactAvatar state={state}><WorkArtifactImage upload={upload} title={taskTitle} index={index} fallbackUrl={localPhotos.find((photo) => upload.id === `${studentToken}:${photo.id}`)?.previewUrl} compact retryControl={false} /></ArtifactAvatar></PhotoThumbnail>
        return compact ? <span className="weekend-math-photo-item" key={upload.id}>{thumbnail}{!selection && onDelete && upload.status !== 'reviewed' && <button type="button" className="weekend-math-photo-delete" aria-label={`Удалить фото ${index + 1}`} disabled={removingId === upload.id} onClick={() => void deletePhoto(upload.id)}><X size={11} aria-hidden="true" /></button>}</span> : thumbnail
      })}
      {localOnly.map((photo, index) => {
        const id = `${studentToken}:${photo.id}`
        const state = localArtifactAvatarState(photo.state)
        const status = artifactAvatarLabel(state)
        const photoLabel = `Фото ${visibleUploads.length + index + 1} · ${status} · Время загрузки появится после передачи фото`
        const thumbnail = <PhotoThumbnail key={photo.id} label={photoLabel} choosing={!!selection} selected={selection ? selection.selectedIds.includes(id) : selectedId === id} disabled={selection?.isSelectable?.(id) === false} onToggle={() => togglePhoto(id)}><ArtifactAvatar state={state}><EducationImage source={photo.previewUrl} alt="" compact retryControl={false} /></ArtifactAvatar></PhotoThumbnail>
        return compact ? <span className="weekend-math-photo-item" key={photo.id}>{thumbnail}</span> : thumbnail
      })}
    </div>
    {!compact && summary && <small className="day-upload-summary">{summary}</small>}
    {!selection && (selectedUpload || selectedLocal) && <div className="day-upload-expanded"><button className="day-upload-close" type="button" aria-label="Закрыть фото" onClick={() => setSelectedId(null)}><X size={17} aria-hidden="true" /></button>
      {selectedUpload ? <><WorkArtifactImage upload={selectedUpload} title={taskTitle} index={visibleUploads.indexOf(selectedUpload)} fallbackUrl={localPhotos.find((photo) => selectedUpload.id === `${studentToken}:${photo.id}`)?.previewUrl} /><WorkUploadTime upload={selectedUpload} /><p role={selectedTransfer?.phase === 'failed' ? 'alert' : undefined}>{purpose === 'help' ? selectedUpload.status === 'upload-error' ? 'Фото недоступно. Обнови страницу и попробуй снова.' : 'Фото сохранено для помощи.' : selectedTransfer?.phase === 'failed' ? selectedTransfer.message : selectedUpload.status === 'reviewed' ? cdzProof ? 'Результат ЦДЗ указан в карточке задания.' : review?.purpose === 'source-material' ? 'Это материал для самопроверки; наблюдения о записях показаны рядом. Фото не является результатом теста.' : 'Разбор этого задания показан в блоке «Проверка работы».' : selectedUpload.status === 'upload-error' ? selectedUpload.error ?? 'Не удалось передать фото. Удалите запись и загрузите снимок снова.' : selectedUpload.status === 'pending' ? activeProcessing(review, [selectedUpload]) ? 'Сейчас проверяем фото.' : 'Фото ждёт разбора.' : 'Исходное фото передаётся напрямую на Яндекс.Диск; дождитесь подтверждения.'} {purpose === 'help' ? '' : selectedUpload.storage?.state === 'stored' ? 'Файл на Яндекс.Диске.' : selectedUpload.status === 'awaiting-upload' ? 'Оригинал передаётся с устройства отправки; пока сервер его не получил.' : 'Исходник остаётся на этом устройстве до передачи.'}</p>{selectedUpload.status === 'awaiting-upload' && <button type="button" className="day-upload-retry" disabled={selectedTransfer?.phase === 'sending'} onClick={() => { const id = selectedUpload.id.startsWith(`${studentToken}:`) ? selectedUpload.id.slice(studentToken.length + 1) : selectedUpload.id; void retryPhotoTransfer(studentToken, id).catch(() => {}) }}>{selectedTransfer?.phase === 'sending' ? <span aria-hidden="true">…</span> : <RotateCcw size={14} aria-hidden="true" />} {selectedTransfer?.phase === 'sending' ? 'Передаём фото…' : 'Повторить передачу'}</button>}{selectedUpload.storage?.publicUrl && <a className="day-upload-original" href={selectedUpload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>}</>
        : selectedLocal && <><EducationImage source={selectedLocal.previewUrl} alt={`Новое фото по заданию «${taskTitle}»`} className="day-upload-photo" /><p className="work-upload-time">Время загрузки появится после передачи фото</p><p>{selectedLocal.state === 'failed' ? selectedLocal.error ?? 'Не удалось загрузить фото.' : selectedLocal.state === 'saved' ? 'Фото сохранено на этом устройстве; передача ещё не подтверждена.' : selectedLocal.state === 'deleting' ? 'Удаляем фото…' : 'Фото загружается…'}</p>{onRetry && selectedLocal.state === 'failed' && removingId !== selectedId && <button type="button" className="day-upload-retry" onClick={() => onRetry(selectedLocal)}><RotateCcw size={14} aria-hidden="true" /> Повторить</button>}</>}
      {onDelete && (selectedUpload && selectedUpload.status !== 'reviewed' || !compact && selectedLocal) && <button className="day-upload-delete" type="button" disabled={removingId === selectedId} onClick={() => selectedId && void deletePhoto(selectedId)}><Trash2 size={14} aria-hidden="true" /> {removingId === selectedId ? 'Удаляем…' : 'Удалить фото'}</button>}
      {deleteError && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
    </div>}
    {deleteError && !selectedUpload && !selectedLocal && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
  </div>
}
