import WorkAttachmentThumbnail from './WorkAttachmentThumbnail'
import { workFilePresentation } from '../../storage/work-file-types.mjs'
import WorkFilePreview from './WorkFilePreview'
/** @see ../../docs/decisions/ui-kit-photo-help-2026-10-27.md */
/** @see ../../docs/decisions/work-photo-thumbnail-decomposition-2026-10-27.md */
/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md */
/** @see ../../docs/decisions/photo-transfer-recovery-2026-10-22.md */
/* @see ../../docs/shared/design/components.md */
/* @see ../../docs/decisions/work-photo-expand-2026-10-18.md */
import { useState, useSyncExternalStore } from 'react'
import { ExternalLink, RotateCcw, Trash2, X } from 'lucide-react'
import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import { activeProcessing, artifactAvatarLabel, artifactAvatarState, localArtifactAvatarState } from '@/lib/reviewPresentation'
import { reportUiError } from '@/lib/uiErrors'
import { getPhotoTransferUiSnapshot, photoTransferUiKey, retryPhotoTransfer, subscribePhotoTransferUi } from '@/lib/photoOutbox'
import EducationImage from './EducationImage'
import ArtifactAvatar, { WorkArtifactImage, WorkUploadTime, workUploadTimeLabel } from './ArtifactAvatar'
import './WorkPhotoGallery.css'

export type LocalWorkPhoto = { file?: File; originalName?: string; contentType?: string; id: string; taskId: string; previewUrl: string; state: 'uploading' | 'saved' | 'failed' | 'deleting'; error?: string }

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
  onRetry?: (photo: T) => void; onDelete?: (uploadId: string) => Promise<void>; compact?: boolean; selection?: WorkPhotoSelection; purpose?: 'help' | 'source' | 'source-complete' | 'contest'
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
  const summary = purpose === 'source' ? [visibleUploads.filter(upload => ['pending', 'reviewed'].includes(upload.status)).length && `${visibleUploads.filter(upload => ['pending', 'reviewed'].includes(upload.status)).length} получено · обработка условий ожидается`, uploadingCount && `${uploadingCount} загружается`, failedCount && `${failedCount} не загрузилось`].filter(Boolean).join(' · ') : purpose === 'source-complete' ? `${visibleUploads.length} фото · задачи добавлены в практику` : purpose === 'contest' ? `${visibleUploads.length - failedCount} сохранено${failedCount ? ` · ${failedCount} недоступно` : ''}` : purpose === 'help' ? `${visibleUploads.length - failedCount} сохранено для помощи${failedCount ? ` · ${failedCount} недоступно` : ''}` : [processingCount && `${processingCount} в разборе`, waitingCount && `${waitingCount} ${waitingCount === 1 ? 'ждёт' : 'ждут'} проверки`, pausedCount && `${pausedCount} с задержкой проверки`, uploadingCount && `${uploadingCount} загружается`, failedCount && `${failedCount} не загрузилось`].filter(Boolean).join(' · ')
  const selectedUpload = visibleUploads.find((upload) => upload.id === selectedId)
  const selectedTransfer = selectedUpload ? transferState(selectedUpload) : undefined
  const selectedLocal = localOnly.find((photo) => `${studentToken}:${photo.id}` === selectedId)
  function togglePhoto(id: string) {
    if (!selection) return setSelectedId(selectedId === id ? null : id)
    selection.onChange(selection.selectedIds.includes(id) ? selection.selectedIds.filter((item) => item !== id) : [...selection.selectedIds, id])
  }
  async function deletePhoto(id: string) {
    if (!onDelete || !compact && !window.confirm(hasDocuments ? 'Удалить этот файл из задания?' : 'Удалить это фото из задания?')) return
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
  const localPreview = (photo: T, compact = false) => workFilePresentation(photo.file ?? photo).kind === 'photo'
    ? <EducationImage source={photo.previewUrl} alt={compact ? '' : `Новое фото по заданию «${taskTitle}»`} compact={compact} retryControl={!compact} className={compact ? '' : 'day-upload-photo'} />
    : <WorkFilePreview file={photo.file ?? photo} compact={compact} href={photo.previewUrl} />
  const hasDocuments = [...visibleUploads, ...localOnly.map(photo => photo.file ?? photo)].some(file => workFilePresentation(file).kind !== 'photo')
  const cdzProof = evidenceLabel === 'Подтверждение ЦДЗ'
  return <div className={`day-upload-list${compact ? ' work-photo-gallery-compact' : ''}`} aria-label={`${hasDocuments ? 'Файлы' : 'Фото'} задания «${taskTitle}»`}>
    {!compact && <div className="day-upload-head"><strong>{hasDocuments ? evidenceLabel.replace('Фото', 'Файлы') : evidenceLabel}</strong><span>{selection ? `Выбрано: ${selection.selectedIds.length}` : purpose === 'help' || purpose === 'source' || purpose === 'source-complete' || purpose === 'contest' ? `${photoCount} ${hasDocuments ? 'файл(ов)' : 'фото'}` : `${reviewedCount} из ${photoCount} ${hasDocuments ? 'файлов' : 'фото'} проверено`}</span></div>}
    {cdzProof && <small className="day-upload-context">Снимок результата МЭШ, присланный ребёнком. Кнопки внутри снимка относятся к МЭШ.</small>}
    <div className={`day-upload-strip${compact ? ' weekend-math-photos' : ''}`}>
      {visibleUploads.map((upload, index) => {
        const transfer = transferState(upload)
        const state = transfer?.phase === 'failed' ? 'failed' : transfer?.phase === 'sending' ? 'uploading' : purpose === 'source-complete' ? 'reviewed' : purpose === 'source' && upload.status === 'reviewed' ? 'waiting' : artifactAvatarState(upload, review, now)
        const status = purpose === 'source-complete' ? 'Фото условия, задачи добавлены' : purpose === 'source' && ['pending', 'reviewed'].includes(upload.status) ? 'Фото получено, обработка условий ожидается' : purpose === 'help' && upload.status !== 'upload-error' ? 'Сохранено для помощи' : artifactAvatarLabel(state)
        const meta = workFilePresentation(upload)
        const photoLabel = meta.kind !== 'photo' ? `${meta.label} ${index + 1} · ${meta.name} · ${status.replace(/фото/g, 'файл')} · ${workUploadTimeLabel(upload)}` : `${upload.origin === 'archive' ? `Фото из архива ${index + 1}` : `Фото ${index + 1}`} · ${status} · ${workUploadTimeLabel(upload)}`
        return <WorkAttachmentThumbnail key={upload.id} compact={compact} onDelete={onDelete && upload.status !== 'reviewed' ? () => void deletePhoto(upload.id) : undefined} deleteLabel={`Удалить ${meta.kind === 'photo' ? 'фото' : 'файл'} ${index + 1}`} deleting={removingId === upload.id} label={photoLabel} choosing={!!selection} selected={selection ? selection.selectedIds.includes(upload.id) : selectedId === upload.id} disabled={selection?.isSelectable?.(upload.id) === false} onToggle={() => togglePhoto(upload.id)}><ArtifactAvatar state={state}><WorkArtifactImage upload={upload} title={taskTitle} index={index} fallbackUrl={localPhotos.find((photo) => upload.id === `${studentToken}:${photo.id}`)?.previewUrl} compact retryControl={false} /></ArtifactAvatar></WorkAttachmentThumbnail>
      })}
      {localOnly.map((photo, index) => {
        const id = `${studentToken}:${photo.id}`
        const state = localArtifactAvatarState(photo.state)
        const status = artifactAvatarLabel(state)
        const meta = workFilePresentation(photo.file ?? photo)
        const photoLabel = `${meta.label} ${visibleUploads.length + index + 1}${meta.kind !== 'photo' ? ` · ${meta.name}` : ''} · ${meta.kind === 'photo' ? status : status.replace(/фото/g, 'файл')} · Время загрузки появится после передачи ${meta.kind === 'photo' ? 'фото' : 'файла'}`
        return <WorkAttachmentThumbnail key={photo.id} compact={compact} label={photoLabel} choosing={!!selection} selected={selection ? selection.selectedIds.includes(id) : selectedId === id} disabled={selection?.isSelectable?.(id) === false} onToggle={() => togglePhoto(id)}><ArtifactAvatar state={state}>{localPreview(photo, true)}</ArtifactAvatar></WorkAttachmentThumbnail>
      })}
    </div>
    {!compact && summary && <small className="day-upload-summary">{summary}</small>}
    {!selection && (selectedUpload || selectedLocal) && <div className="day-upload-expanded"><button className="day-upload-close" type="button" aria-label={hasDocuments ? 'Закрыть файл' : 'Закрыть фото'} onClick={() => setSelectedId(null)}><X size={17} aria-hidden="true" /></button>
      {selectedUpload ? <><WorkArtifactImage upload={selectedUpload} title={taskTitle} index={visibleUploads.indexOf(selectedUpload)} fallbackUrl={localPhotos.find((photo) => selectedUpload.id === `${studentToken}:${photo.id}`)?.previewUrl} /><WorkUploadTime upload={selectedUpload} /><p role={selectedTransfer?.phase === 'failed' ? 'alert' : undefined}>{purpose === 'source-complete' ? 'Фото условий сохранено; задачи добавлены в практику.' : purpose === 'source' && ['pending', 'reviewed'].includes(selectedUpload.status) ? 'Фото условий получено; обработка ожидается.' : purpose === 'contest' ? 'Фото сохранено. До окончания тура автоматической проверки нет.' : purpose === 'help' ? selectedUpload.status === 'upload-error' ? hasDocuments ? 'Файл недоступен. Обнови страницу и попробуй снова.' : 'Фото недоступно. Обнови страницу и попробуй снова.' : hasDocuments ? 'Файл сохранён для помощи.' : 'Фото сохранено для помощи.' : selectedTransfer?.phase === 'failed' ? selectedTransfer.message : selectedUpload.status === 'reviewed' ? cdzProof ? 'Результат ЦДЗ указан в карточке задания.' : review?.purpose === 'source-material' ? `Это материал для самопроверки; наблюдения о записях показаны рядом. ${hasDocuments ? 'Файл' : 'Фото'} не является результатом теста.` : 'Разбор этого задания показан в блоке «Проверка работы».' : selectedUpload.status === 'upload-error' ? selectedUpload.error ?? 'Не удалось передать файл. Удалите запись и загрузите его снова.' : selectedUpload.status === 'pending' ? activeProcessing(review, [selectedUpload]) ? hasDocuments ? 'Сейчас проверяем файл.' : 'Сейчас проверяем фото.' : hasDocuments ? 'Файл ждёт разбора.' : 'Фото ждёт разбора.' : 'Исходный файл передаётся напрямую на Яндекс.Диск; дождитесь подтверждения.'} {purpose === 'help' ? '' : selectedUpload.storage?.state === 'stored' ? 'Файл на Яндекс.Диске.' : selectedUpload.status === 'awaiting-upload' ? 'Оригинал передаётся с устройства отправки; пока сервер его не получил.' : 'Исходник остаётся на этом устройстве до передачи.'}</p>{selectedUpload.status === 'awaiting-upload' && <button type="button" className="day-upload-retry" disabled={selectedTransfer?.phase === 'sending'} onClick={() => { const id = selectedUpload.id.startsWith(`${studentToken}:`) ? selectedUpload.id.slice(studentToken.length + 1) : selectedUpload.id; void retryPhotoTransfer(studentToken, id).catch(() => {}) }}>{selectedTransfer?.phase === 'sending' ? <span aria-hidden="true">…</span> : <RotateCcw size={14} aria-hidden="true" />} {selectedTransfer?.phase === 'sending' ? hasDocuments ? 'Передаём файл…' : 'Передаём фото…' : 'Повторить передачу'}</button>}{selectedUpload.storage?.publicUrl && <a className="day-upload-original" href={selectedUpload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>}</>
        : selectedLocal && <>{localPreview(selectedLocal)}<p className="work-upload-time">{hasDocuments ? 'Время загрузки появится после передачи файла' : 'Время загрузки появится после передачи фото'}</p><p>{selectedLocal.state === 'failed' ? selectedLocal.error ?? (hasDocuments ? 'Не удалось загрузить файл.' : 'Не удалось загрузить фото.') : selectedLocal.state === 'saved' ? hasDocuments ? 'Файл сохранён на этом устройстве; передача ещё не подтверждена.' : 'Фото сохранено на этом устройстве; передача ещё не подтверждена.' : selectedLocal.state === 'deleting' ? hasDocuments ? 'Удаляем файл…' : 'Удаляем фото…' : hasDocuments ? 'Файл загружается…' : 'Фото загружается…'}</p>{onRetry && selectedLocal.state === 'failed' && removingId !== selectedId && <button type="button" className="day-upload-retry" onClick={() => onRetry(selectedLocal)}><RotateCcw size={14} aria-hidden="true" /> Повторить</button>}</>}
      {onDelete && (selectedUpload && selectedUpload.status !== 'reviewed' || !compact && selectedLocal) && <button className="day-upload-delete" type="button" disabled={removingId === selectedId} onClick={() => selectedId && void deletePhoto(selectedId)}><Trash2 size={14} aria-hidden="true" /> {removingId === selectedId ? 'Удаляем…' : hasDocuments ? 'Удалить файл' : 'Удалить фото'}</button>}
      {deleteError && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
    </div>}
    {deleteError && !selectedUpload && !selectedLocal && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
  </div>
}
