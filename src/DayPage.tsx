import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Camera, CheckCircle2, ChevronDown, Clock3, ExternalLink, RotateCcw, Trash2, X } from 'lucide-react'
import { removePendingDayPhoto, requestDayHelp, uploadDayPhoto, uploadMatchesTask, watchDayHelp, watchDayPage, watchMaterialPages } from '@/lib/dayStore'
import type { DayHelp, DayInstruction, DayMaterialLink, DayPageData, DayTask, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { loadAnswerKey, watchAssignment, watchDashboard } from '@/lib/store'
import { dayHelpSessionRole } from '@/lib/personalAccess'
import { grade } from '@/lib/quiz'
import type { Assignment } from '@/lib/quiz'
import MaterialReader, { canReadInside } from '@/components/MaterialReader'
import PublicThumbnail from '@/components/PublicThumbnail'
import ArtifactAvatar from '@/components/ArtifactAvatar'
import WorkReview from '@/components/WorkReview'
import ProblemGroup from '@/components/ProblemGroup'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import { useDayEvidence } from '@/lib/useDayEvidence'
import { activeProcessing, artifactAvatarLabel, artifactAvatarState, localArtifactAvatarState, problemCardState } from '@/lib/reviewPresentation'
import { publicImage } from '@/lib/yandexPublic'
import { localPhotoForTransfer } from '@/lib/photoOutbox'
import './DayPage.css'

type TestItem = { token: string; testId: string; linkedToTestId?: string | null; title: string; description?: string; subject: string; slug: string; previewToken: string; status: Assignment['status']; answered: number; total: number; points?: number; maxPoints?: number }
type LocalPhoto = { id: string; taskId: string; file: File; previewUrl: string; state: 'uploading' | 'saved' | 'failed' | 'deleting'; error?: string }

/**
 * Показывает работу из временной очереди или по ссылке на проверенный файл Диска.
 * @see ../docs/product/day-page.md#photo-preview
 * @see ../docs/product/storage-privacy.md#upload-queue
 */
function WorkPhoto({ upload, title, index, compact = false }: { upload: DayUpload; title: string; index: number; compact?: boolean }) {
  const [src, setSrc] = useState(upload.dataUrl ?? '')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (upload.dataUrl) { setSrc(upload.dataUrl); setFailed(false); return }
    const url = upload.storage?.publicUrl
    if (!url) {
      const [studentToken, uploadId] = upload.id.split(':')
      let active = true
      let objectUrl = ''
      void localPhotoForTransfer(studentToken, uploadId).then((blob) => {
        if (active && blob) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl) }
      }).catch(() => setSrc(''))
      return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    }
    if (compact) return
    let active = true
    setSrc('')
    setFailed(false)
    void publicImage(url, compact ? 'S' : 'XXXL').then((image) => { if (active) setSrc(image) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [upload.id, upload.dataUrl, upload.storage?.publicUrl, compact])
  if (compact && !upload.dataUrl && upload.storage?.publicUrl) return <PublicThumbnail url={upload.storage.publicUrl} alt={`Работа по заданию «${title}», фото ${index + 1}`} fallback={<span className="artifact-avatar-placeholder"><Camera size={15} aria-hidden="true" /></span>} />
  if (compact && (failed || !src)) return <span className="artifact-avatar-placeholder"><Camera size={15} aria-hidden="true" /></span>
  if (failed || !src) return upload.storage?.publicUrl
    ? <p><a href={upload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть фото на Яндекс.Диске</a></p>
    : <p>Фото ожидает передачи на Яндекс.Диск.</p>
  return <img src={src} alt={`Работа по заданию «${title}», фото ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

/**
 * Разделяет технический статус снимка и педагогический результат задания.
 * @see ../docs/product/day-page.md#photo-status
 */
function PhotoStrip({ taskTitle, evidenceLabel = 'Фото работы', studentToken, uploads, localPhotos, review, now, onRetry, onDelete }: {
  taskTitle: string; evidenceLabel?: string; studentToken: string; uploads: DayUpload[]; localPhotos: LocalPhoto[]; review?: DayWorkReview; now: number;
  onRetry: (photo: LocalPhoto) => void; onDelete: (uploadId: string) => Promise<void>
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
    if (!window.confirm('Удалить это фото из задания?')) return
    setRemovingId(id)
    setDeleteError('')
    try {
      await onDelete(id)
      setRemovedIds((current) => [...current, id])
      setSelectedId(null)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Не удалось удалить фото. Повторите попытку.')
    } finally {
      setRemovingId(null)
    }
  }
  return <div className="day-upload-list" aria-label={`Фото задания «${taskTitle}»`}>
    <div className="day-upload-head"><strong>{evidenceLabel}</strong><span>Проверено {reviewedCount} из {photoCount}</span></div>
    <div className="day-upload-strip">
      {visibleUploads.map((upload, index) => {
        const state = artifactAvatarState(upload, review, now)
        const status = artifactAvatarLabel(state)
        return <button className="day-upload-chip" type="button" key={upload.id} title={`${upload.origin === 'archive' ? 'Ранее загруженная работа' : `Фото ${index + 1}`} · ${status}`} aria-label={`Открыть фото ${index + 1}: ${status}`} aria-expanded={selectedId === upload.id} onClick={() => setSelectedId(selectedId === upload.id ? null : upload.id)}><ArtifactAvatar state={state}><WorkPhoto upload={upload} title={taskTitle} index={index} compact /></ArtifactAvatar></button>
      })}
      {localOnly.map((photo, index) => {
        const id = `${studentToken}:${photo.id}`
        const state = localArtifactAvatarState(photo.state)
        const status = artifactAvatarLabel(state)
        return <button className="day-upload-chip" type="button" key={photo.id} title={`Фото ${visibleUploads.length + index + 1} · ${status}`} aria-label={`Открыть фото ${visibleUploads.length + index + 1}: ${status}`} aria-expanded={selectedId === id} onClick={() => setSelectedId(selectedId === id ? null : id)}><ArtifactAvatar state={state}><img src={photo.previewUrl} alt="" /></ArtifactAvatar></button>
      })}
    </div>
    <div className="day-upload-progress" role="progressbar" aria-label="Проверенные фотографии" aria-valuemin={0} aria-valuemax={photoCount} aria-valuenow={reviewedCount}><span style={{ width: `${reviewedCount / photoCount * 100}%` }} /></div>
    {summary && <small className="day-upload-summary">{summary}</small>}
    {(selectedUpload || selectedLocal) && <div className="day-upload-expanded"><button className="day-upload-close" type="button" aria-label="Закрыть фото" onClick={() => setSelectedId(null)}><X size={17} aria-hidden="true" /></button>
      {selectedUpload ? <><WorkPhoto upload={selectedUpload} title={taskTitle} index={visibleUploads.indexOf(selectedUpload)} /><p>{selectedUpload.status === 'reviewed' ? evidenceLabel === 'Подтверждение ЦДЗ' ? 'Результат ЦДЗ указан в карточке задания.' : 'Разбор этого задания показан в блоке «Проверка работы».' : selectedUpload.status === 'upload-error' ? selectedUpload.error ?? 'Не удалось передать фото. Удалите запись и загрузите снимок снова.' : selectedUpload.status === 'pending' ? activeProcessing(review, [selectedUpload]) ? 'Сейчас проверяем фото.' : 'Фото ждёт разбора.' : 'Исходное фото передаётся напрямую на Яндекс.Диск; дождитесь подтверждения.'} {selectedUpload.storage?.state === 'stored' ? 'Файл на Яндекс.Диске.' : 'Исходник остаётся на этом устройстве до передачи.'}</p>{selectedUpload.storage?.publicUrl && <a className="day-upload-original" href={selectedUpload.storage.publicUrl} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>}</>
        : selectedLocal && <><img src={selectedLocal.previewUrl} alt={`Новое фото по заданию «${taskTitle}»`} /><p>{selectedLocal.state === 'failed' ? selectedLocal.error ?? 'Не удалось загрузить фото.' : selectedLocal.state === 'saved' ? 'Фото сохранено и ждёт разбора.' : selectedLocal.state === 'deleting' ? 'Удаляем фото…' : 'Фото загружается…'}</p>{selectedLocal.state === 'failed' && removingId !== selectedId && <button type="button" className="day-upload-retry" onClick={() => onRetry(selectedLocal)}><RotateCcw size={14} aria-hidden="true" /> Повторить</button>}</>}
      {(selectedUpload && selectedUpload.status !== 'reviewed' || selectedLocal) && <button className="day-upload-delete" type="button" disabled={removingId === selectedId} onClick={() => selectedId && void deletePhoto(selectedId)}><Trash2 size={14} aria-hidden="true" /> {removingId === selectedId ? 'Удаляем…' : 'Удалить фото'}</button>}
      {deleteError && <p className="day-upload-delete-error" role="alert">{deleteError}</p>}
    </div>}
  </div>
}

/**
 * Показывает живое состояние связанного теста внутри домашнего задания.
 * @see ../docs/product/day-page.md#test-progress
 */
function TestProgress({ test }: { test: TestItem }) {
  const answered = Math.min(test.answered, test.total)
  const remaining = Math.max(0, test.total - answered)
  const label = test.status === 'submitted'
    ? test.points == null ? 'Тест отправлен · результат уточняется' : `Результат · ${test.points} из ${test.maxPoints} верно`
    : answered ? `В процессе · осталось ${remaining} из ${test.total} вопросов`
      : `Тест не начат · осталось ${remaining} из ${test.total} вопросов`
  return <div className="day-test-progress">
    <span>{label}</span>
    <div className="day-test-track" role="progressbar" aria-label="Ответы на вопросы теста" aria-valuemin={0} aria-valuemax={test.total} aria-valuenow={answered}>
      <span style={{ width: `${test.total ? answered / test.total * 100 : 0}%` }} />
    </div>
  </div>
}

/** @see ../docs/product/day-page.md#quiz-lineage */
function quizChain(root: TestItem | undefined, tests: TestItem[]): TestItem[] {
  if (!root) return []
  const chain = [root]
  const seen = new Set([root.testId])
  while (true) {
    const next = tests.find((test) => test.linkedToTestId === chain[chain.length - 1].testId && !seen.has(test.testId))
    if (!next) return chain
    chain.push(next)
    seen.add(next.testId)
  }
}

/** @see ../docs/product/day-page.md#quiz-lineage */
function QuizLineageCard({ chain, parent, task, materialLinks = [] }: { chain: TestItem[]; parent: boolean; task?: DayTask; materialLinks?: DayMaterialLink[] }) {
  const latest = chain[chain.length - 1]
  const earlier = chain.slice(0, -1)
  const graded = earlier.filter((test) => test.status === 'submitted' && test.points != null && test.maxPoints != null)
  const points = graded.reduce((sum, test) => sum + (test.points ?? 0), 0)
  const max = graded.reduce((sum, test) => sum + (test.maxPoints ?? 0), 0)
  const href = parent && latest.status !== 'submitted' && latest.previewToken ? `#/preview/${latest.slug}~${latest.previewToken}` : `#/t/${latest.slug}~${latest.token}`
  const label = parent ? latest.status === 'submitted' ? 'Посмотреть результат' : 'Посмотреть вопросы' : latest.status === 'submitted' ? 'Посмотреть результат' : latest.answered ? 'Продолжить повторный тест' : 'Пройти повторный тест'
  const context = task?.title.match(/Упр\.\s*\d+/i)?.[0] ?? task?.title ?? 'Самопроверка'
  const hasScore = latest.status === 'submitted' && latest.points != null && latest.maxPoints != null
  const scoreLabel = hasScore ? `${latest.points} из ${latest.maxPoints}` : latest.status === 'submitted' ? 'Результат уточняется' : latest.answered ? 'В процессе' : 'Не начат'
  const readerLinks = materialLinks.filter(canReadInside)
  const otherLinks = materialLinks.filter((link) => !canReadInside(link))
  return <section className="day-quiz-lineage" aria-label={`Самопроверки: ${context}`}>
    <div className="day-quiz-lineage-head"><strong>Самопроверка по {context.toLowerCase()}</strong><span className={`day-quiz-lineage-score${hasScore && latest.points === latest.maxPoints ? ' complete' : hasScore ? ' partial' : ''}`}>{scoreLabel}</span></div>
    <div className="day-quiz-lineage-current"><small>{latest.status === 'submitted' ? 'Последний тест' : latest.answered ? 'Сейчас · в процессе' : 'Сейчас · закрепляем ошибку'}</small><h3>{latest.title}</h3>{latest.description && <p>{latest.description}</p>}
      <div className="day-quiz-lineage-actions"><a className="day-quiz-link" href={href}>{label} <ExternalLink size={15} aria-hidden="true" /></a></div>
      {task && <details className="day-quiz-materials"><summary>Условие и страницы учебника <ChevronDown size={15} aria-hidden="true" /></summary><div><p>{task.detail}</p>{!!task.steps?.length && <ol className="day-task-steps">{task.steps.map((step, index) => <Instruction key={index} item={step} index={index} />)}</ol>}{readerLinks.length > 0 && <MaterialReader links={readerLinks} parent={parent} />}{otherLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.title} <ExternalLink size={13} aria-hidden="true" /></a>)}</div></details>}
    </div>
    <details className="day-quiz-history"><summary><span><strong>Предыдущие тесты</strong><small>{earlier.length} {earlier.length === 1 ? 'тест' : earlier.length < 5 ? 'теста' : 'тестов'}{max ? ` · ${points} из ${max} баллов` : ''}</small></span>{max > 0 && <span className={`day-quiz-history-score ${points === max ? 'complete' : ''}`} aria-label={`${Math.round(points / max * 100)} процентов набранных баллов`}><i style={{ width: `${Math.round(points / max * 100)}%` }} />{Math.round(points / max * 100)}%</span>}<ChevronDown size={18} aria-hidden="true" /></summary><div className="day-quiz-history-body">{earlier.map((test) => <div className="day-quiz-history-row" key={test.token}><strong>{test.title}</strong><span>{test.status === 'submitted' ? test.points == null ? 'Отправлен · балл уточняется' : `${test.points} из ${test.maxPoints} баллов` : 'Не завершён'}</span><a href={parent && test.status !== 'submitted' && test.previewToken ? `#/preview/${test.slug}~${test.previewToken}` : `#/t/${test.slug}~${test.token}`}>{test.status === 'submitted' ? 'Посмотреть результат' : 'Посмотреть вопросы'} <ExternalLink size={13} aria-hidden="true" /></a></div>)}</div></details>
  </section>
}

/** @see ../docs/product/day-page.md#instruction-provenance */
function Instruction({ item, index }: { item: DayInstruction; index: number }) {
  const source = typeof item === 'string' ? undefined : item.source
  const uncertain = !source || source.certainty === 'uncertain'
  const text = typeof item === 'string' ? item : item.text
  return <li><span>{text}</span>{' '}
    <details className={`day-instruction-source${uncertain ? ' uncertain' : ''}`}>
      <summary title={uncertain ? 'Источник не подтверждён. Показать пояснение' : `Откуда взят пункт ${index + 1}`} aria-label={uncertain ? `Источник пункта ${index + 1} не подтверждён. Показать пояснение` : `Откуда взят пункт ${index + 1}`}>?</summary>
      <span className="day-instruction-source-body"><button className="day-instruction-source-close" type="button" aria-label="Закрыть пояснение" onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>×</button>{source ? <><b>{source.label}</b><span>{source.evidence}</span>{source.ref && <small>{source.ref}</small>}{uncertain && <em>Это не подтверждённое требование учителя.</em>}</> : <><b>Источник не указан</b><span>Не считай это дополнительным требованием учителя, пока источник не сверят.</span></>}</span>
    </details>
  </li>
}

function shortDate(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }
function dayMonth(date: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`)) }
function fives(count: number) { return count === 1 ? 'пятёрка' : count >= 2 && count <= 4 ? 'пятёрки' : 'пятёрок' }
function formatAverage(value: number) { return value.toFixed(2).replace('.', ',') }
function formatChange(value: number) { return `${value >= 0 ? '+' : '−'}${formatAverage(Math.abs(value))}` }
function localMinutes() { const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Moscow' }).format(new Date()).split(':').map(Number); return parts[0] * 60 + parts[1] }
function moscowToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
/** @see ../docs/product/day-page.md#day-page */
function activeView(page: DayPageData): 'homework' | 'school' {
  if (page.date !== moscowToday()) return 'school'
  const last = page.todaySchedule.map((lesson) => lesson.end).sort().at(-1)
  if (!last) return 'homework'
  const [hour, minute] = last.split(':').map(Number)
  return localMinutes() < hour * 60 + minute ? 'school' : 'homework'
}
function statusLabel(status: DayTask['status']) { return ({ verified: 'Проверено', 'needs-fix': 'Нужно исправить', partial: 'Часть сделана', unknown: 'Статус неизвестен' })[status] }
/** @see ../docs/product/grades.md#grade-badge */
function forecast(grades: { mark: number; weight: number }[], next: number, nextWeight: number, threshold: number) {
  const points = grades.reduce((sum, { mark, weight }) => sum + mark * weight, 0) + next * nextWeight
  const weight = grades.reduce((sum, { weight: value }) => sum + value, 0) + nextWeight
  const average = points / weight
  const needed = Math.max(0, Math.ceil((threshold * weight - points) / (5 - threshold) - 1e-8))
  return { average, needed }
}

type GradeSummary = DayPageData['gradeSummary'][number]
type GradeDetails = NonNullable<DayPageData['grades']>[number]
const scheduleGradeIds: Record<string, string> = {
  'Английский язык': 'english', 'Математика': 'math', 'Русский язык': 'russian',
  'Литература': 'literature', 'История': 'history', 'Биология': 'biology',
  'Технология': 'technology', 'Изобразительное искусство': 'art', 'ИЗО': 'art',
  'География': 'geography',
}
function isExcellent(summary: GradeSummary) { return summary.allFives ?? summary.average >= 4.99 }
function needsAttention(summary: GradeSummary) { return !isExcellent(summary) && (summary.watch ?? summary.average < 4.7) }
function canForecast(summary: GradeSummary, details?: GradeDetails) {
  if (!details?.scenario_verified || !details.grades?.length || details.grades.some(({ mark, weight }) => !Number.isFinite(mark) || !Number.isFinite(weight) || weight <= 0)) return false
  const points = details.grades.reduce((sum, { mark, weight }) => sum + mark * weight, 0)
  const weight = details.grades.reduce((sum, { weight: value }) => sum + value, 0)
  return Math.abs(points / weight - summary.average) < 0.015
}
/**
 * Компактная метка среднего с условным сценарием при наличии сверенных оценок.
 * @see ../docs/product/grades.md#grade-badge
 */
function GradeBadge({ summary, details, threshold, asOf }: { summary?: GradeSummary; details?: GradeDetails; threshold?: number; asOf?: string }) {
  const [open, setOpen] = useState(false)
  const [nextMark, setNextMark] = useState(4)
  const [nextWeight, setNextWeight] = useState(1)
  if (!summary) return null
  const excellent = isExcellent(summary)
  if (excellent) return <span className="day-grade excellent">🌟 5,00 · супер</span>
  if (!needsAttention(summary)) return <span className="day-grade">{formatAverage(summary.average)} · запас есть</span>
  const reliable = canForecast(summary, details) && threshold != null && threshold > 0 && threshold < 5
  const result = reliable ? forecast(details!.grades, nextMark, nextWeight, threshold!) : null
  return <>
    <button type="button" className="day-grade watch day-grade-button" aria-expanded={open} aria-label={`Средний по предмету ${formatAverage(summary.average)}. ${open ? 'Скрыть' : 'Показать'} сценарий следующей оценки`} onClick={() => setOpen((value) => !value)}><span>{formatAverage(summary.average)}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="day-grade-expand"><div className="day-grade-box">
      {result ? <>
        <div className="day-grade-toolbar"><span className="day-grade-expand-title">Оценка</span><div className="day-grade-choices" role="group" aria-label="Следующая оценка">{[3, 4, 5].map((mark) => <button key={mark} type="button" aria-pressed={nextMark === mark} onClick={() => setNextMark(mark)}>{mark}</button>)}</div><label className="day-grade-weight">Вес <select aria-label="Вес следующей оценки: ×1 обычная, ×2 условная" value={nextWeight} onChange={(event) => setNextWeight(Number(event.target.value))}><option value="1">×1</option><option value="2">×2</option></select></label></div>
        <p className="day-grade-result"><strong>{formatAverage(summary.average)} → {formatAverage(result.average)}</strong><span>{formatChange(result.average - summary.average)} · {result.needed === 0 ? 'ориентир сохранится' : `ещё ${result.needed} ${fives(result.needed)} до ориентира`}</span></p>
      </> : <p className="day-grade-unavailable">Прогноз ждёт сверки всех оценок. Текущий средний — {formatAverage(summary.average)}.</p>}
      <small>{asOf ? `Срез ${dayMonth(asOf)} · ` : ''}порог {threshold ? formatAverage(threshold) : 'не задан'} и вес ×2 условны · годовая отметка не рассчитана</small>
    </div></div>}
  </>
}

/**
 * Показывает план дня и связывает задания с фото, материалами и тестами.
 * @see ../docs/product/day-page.md#day-page
 * @see ../docs/product/day-page.md#day-navigation
 * @see ../docs/product/access-and-state.md#state
 */
export default function DayPage({ token, parent, headerReturnTarget }: { token: string; parent: boolean; headerReturnTarget: HTMLElement | null }) {
  /** @see ../docs/product/dashboard.md#day-navigation */
  const [requestedView] = useState(() => {
    const query = new URLSearchParams(window.location.search).get('tab')
    const stored = sessionStorage.getItem('education-day-initial-tab')
    sessionStorage.removeItem('education-day-initial-tab')
    return query ?? stored
  })
  const [returnToDashboard] = useState(() => {
    const saved = sessionStorage.getItem('education-day-dashboard-return') ?? ''
    return new RegExp(`^#/${parent ? 'days-parent' : 'days'}/[A-Za-z0-9_-]{20,}$`).test(saved) ? saved : ''
  })
  const [page, setPage] = useState<DayPageData>()
  const [catalogPages, setCatalogPages] = useState<Record<string, DayMaterialLink>>({})
  const [helpRequests, setHelpRequests] = useState<DayHelp[]>([])
  const [helpRole, setHelpRole] = useState<'checking' | 'student' | 'parent' | 'none'>('checking')
  const [tests, setTests] = useState<TestItem[]>([])
  const [view, setView] = useState<'homework' | 'school'>(requestedView === 'homework' ? 'homework' : 'school')
  const [manualView, setManualView] = useState(requestedView === 'homework' || requestedView === 'school')
  const [error, setError] = useState('')
  const { studentToken, evidenceKey, uploads, reviews, ready: evidenceReady } = useDayEvidence(page, token, setError)
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([])
  const [statusNow, setStatusNow] = useState(() => Date.now())
  const photoUrls = useRef(new Set<string>())
  const uploadJobs = useRef(new Map<string, Promise<void>>())

  useEffect(() => () => { for (const url of photoUrls.current) URL.revokeObjectURL(url) }, [])
  const hasPendingUploads = uploads.some((upload) => upload.status === 'pending')
  useEffect(() => {
    if (!hasPendingUploads) return
    const timer = window.setInterval(() => setStatusNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [hasPendingUploads])
  useEffect(() => {
    const saved = localPhotos.filter((item) => item.state === 'saved' && uploads.some((upload) => upload.id === `${studentToken}:${item.id}` && (upload.status === 'pending' || upload.status === 'reviewed')))
    if (!saved.length) return
    for (const item of saved) { URL.revokeObjectURL(item.previewUrl); photoUrls.current.delete(item.previewUrl) }
    const ids = new Set(saved.map((item) => item.id))
    setLocalPhotos((current) => current.filter((item) => !ids.has(item.id)))
  }, [localPhotos, uploads, studentToken])

  useEffect(() => {
    let active = true
    let stops: (() => void)[] = []
    let connected = false
    stops.push(watchDayPage(token, (data) => {
      if (!active) return
      if ((parent && data.kind !== 'parent') || (!parent && data.kind !== 'student')) { setError('Эта ссылка предназначена для другой страницы.'); return }
      setPage(data)
      if (connected) return
      connected = true
      let generation = 0
      let assignmentStops: (() => void)[] = []
      stops.push(watchDashboard(data.boardToken, (index) => {
        generation += 1
        const current = generation
        assignmentStops.forEach((stop) => stop())
        assignmentStops = []
        const rows = new Map<string, TestItem>()
        if (!index.length) setTests([])
        for (const item of index) {
          const stop = watchAssignment(item.token, (assignment) => {
            if (!active || generation !== current) return
            rows.set(item.token, {
              token: item.token, testId: assignment.testId, linkedToTestId: assignment.linkedToTestId, title: item.title, description: assignment.description, subject: item.subject, slug: item.slug, previewToken: item.previewToken,
              status: assignment.status, answered: Object.values(assignment.answers ?? {}).filter((answer) => answer !== '' && (!Array.isArray(answer) || answer.length > 0)).length,
              total: assignment.questions.length,
            })
            const show = () => setTests([...rows.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'ru')))
            show()
            if (assignment.status === 'submitted') {
              void loadAnswerKey(item.token).then((key) => {
                if (!active || generation !== current) return
                const results = grade(assignment, key)
                rows.set(item.token, { ...rows.get(item.token)!, points: results.reduce((sum, result) => sum + (result.points ?? 0), 0), maxPoints: assignment.questions.reduce((sum, question) => sum + question.points, 0) })
                show()
              }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось получить результат теста.'))
            }
          }, (cause) => setError(cause.message))
          assignmentStops.push(stop)
        }
      }, (cause) => setError(cause.message)))
      stops.push(() => assignmentStops.forEach((stop) => stop()))
    }, (cause) => { if (active) setError(cause.message) }))
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [token, parent])
  useEffect(() => {
    const refs = Object.values(page?.taskPageRefs ?? {}).flat()
    if (!refs.length) return
    return watchMaterialPages(refs, setCatalogPages, () => {
      // Legacy day links remain available while a device reconnects to its family session.
    })
  }, [page?.taskPageRefs])

  const hasPage = Boolean(page)
  useEffect(() => {
    let active = true
    void dayHelpSessionRole().then((role) => { if (active) setHelpRole(role ?? 'none') })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!hasPage || helpRole === 'checking' || helpRole === 'none') return
    return watchDayHelp(evidenceKey.split('|'), setHelpRequests, (cause) => {
      if ((cause as Error & { code?: string }).code === 'permission-denied') { setHelpRole('none'); setHelpRequests([]) }
      else setError(cause.message)
    })
  }, [evidenceKey, hasPage, helpRole])
  useEffect(() => {
    if (!page || manualView) return
    const update = () => setView(activeView(page))
    update()
    const timer = window.setInterval(update, 60_000)
    return () => window.clearInterval(timer)
  }, [page, manualView])
  const currentPlacements = useMemo(() => (page?.testPlacements ?? []).filter((placement) => (placement.originDate ?? page?.targetDate) === page?.targetDate), [page])
  const dayTests = useMemo(() => [...new Map(currentPlacements.flatMap((placement) => quizChain(tests.find((item) => item.token === placement.token), tests)).map((item) => [item.token, item])).values()], [currentPlacements, tests])
  const pending = useMemo(() => {
    if (!page) return 0
    const taskPending = page.subjects.flatMap((subject) => subject.tasks).filter((task) => (task.originDate ?? page.targetDate) === page.targetDate).filter((task) => {
      if (task.status === 'verified') return false
      if (task.kind === 'written') return !uploads.some((upload) => uploadMatchesTask(upload, task.id) && (upload.status === 'pending' || task.status === 'unknown'))
        && !localPhotos.some((photo) => photo.taskId === task.id && photo.state === 'saved')
      if (task.kind === 'read') { const test = tests.find((item) => item.token === task.testToken); return !(test?.status === 'submitted' && test.points != null && test.points >= (task.requiredPoints ?? test.maxPoints ?? 1)) }
      return true
    }).length
    const testPending = currentPlacements.filter((placement) => !placement.taskId && quizChain(tests.find((item) => item.token === placement.token), tests).at(-1)?.status !== 'submitted').length
    return taskPending + testPending
  }, [page, uploads, localPhotos, tests, currentPlacements])
  async function sendPhoto(photo: LocalPhoto) {
    setLocalPhotos((current) => current.map((item) => item.id === photo.id && item.state !== 'deleting' ? { ...item, state: 'uploading', error: undefined } : item))
    try {
      await uploadDayPhoto(studentToken, photo.taskId, photo.file, photo.id, page?.planRevision)
      setLocalPhotos((current) => current.map((item) => item.id === photo.id && item.state !== 'deleting' ? { ...item, state: 'saved' } : item))
    } catch (cause) {
      setLocalPhotos((current) => current.map((item) => item.id === photo.id && item.state !== 'deleting'
        ? { ...item, state: 'failed', error: cause instanceof Error ? cause.message : 'Не удалось загрузить фото.' } : item))
    }
  }
  function queuePhotoUpload(photo: LocalPhoto) {
    const job = sendPhoto(photo)
    uploadJobs.current.set(photo.id, job)
    void job.finally(() => { if (uploadJobs.current.get(photo.id) === job) uploadJobs.current.delete(photo.id) })
  }
  async function deletePhoto(qualifiedId: string) {
    const colon = qualifiedId.indexOf(':')
    if (colon < 1) throw new Error('Не удалось определить фото. Обновите страницу.')
    const ownerToken = qualifiedId.slice(0, colon)
    const uploadId = qualifiedId.slice(colon + 1)
    const local = localPhotos.find((photo) => photo.id === uploadId)
    if (local) setLocalPhotos((current) => current.map((photo) => photo.id === uploadId ? { ...photo, state: 'deleting' } : photo))
    try {
      await uploadJobs.current.get(uploadId)
      await removePendingDayPhoto(ownerToken, uploadId)
      if (local) {
        URL.revokeObjectURL(local.previewUrl)
        photoUrls.current.delete(local.previewUrl)
        setLocalPhotos((current) => current.filter((photo) => photo.id !== uploadId))
      }
    } catch (cause) {
      if (local) setLocalPhotos((current) => current.map((photo) => photo.id === uploadId ? { ...photo, state: 'failed', error: cause instanceof Error ? cause.message : 'Не удалось удалить фото.' } : photo))
      throw cause
    }
  }
  function attach(task: { id: string }, files: File[]) {
    if (!files.length) return
    const photos = files.map((file) => {
      const previewUrl = URL.createObjectURL(file)
      photoUrls.current.add(previewUrl)
      return { id: crypto.randomUUID(), taskId: task.id, file, previewUrl, state: 'uploading' as const }
    })
    setLocalPhotos((current) => [...current, ...photos])
    for (const photo of photos) queuePhotoUpload(photo)
  }

  if (error && !page) return <div className="day-error"><h1>Не получилось открыть страницу</h1><p>{error}</p></div>
  if (!page) return <p className="day-loading">Загружаем страницу дня…</p>
  const currentSubjects = page.subjects.map((subject) => ({ ...subject, tasks: subject.tasks.filter((task) => (task.originDate ?? page.targetDate) === page.targetDate) }))
    .filter((subject) => subject.tasks.length || currentPlacements.some((placement) => placement.subjectId === subject.id && !placement.taskId))
  const noSpecialHomework = page.targetSchedule.some((lesson) => /Спецкурс|Специальный курс/i.test(lesson.subject))
    && !currentSubjects.some((subject) => subject.id === 'special')
  const currentTaskIds = new Set(currentSubjects.flatMap((subject) => subject.tasks.map((task) => task.id)))
  const lastChange = page.changes?.[0]
  const currentAdded = lastChange?.added.filter((id) => currentTaskIds.has(id)) ?? []
  const currentChanged = lastChange?.changed.filter((id) => currentTaskIds.has(id)) ?? []

  return <>{headerReturnTarget && createPortal(<a className="day-return day-return-header" href={returnToDashboard || '#/'}>← На главную</a>, headerReturnTarget)}<div className={`day-page ${parent ? 'day-parent' : 'day-student'}`}>
    <a className="day-return day-return-content" href={returnToDashboard || '#/'}>← На главную</a>
    <section className="day-hero">
      <div className="day-kicker">{parent ? 'Панель родителя' : 'Мой план'} · {shortDate(page.date)}</div>
      <h1>{page.date === moscowToday() ? (parent ? 'Что требует внимания' : 'Сегодня справимся 👋') : `День · ${shortDate(page.date)}`}</h1>
      <p>{parent ? `Домашнее задание к ${dayMonth(page.targetDate)}: только назначения на эту дату. Выполненные заранее работы появятся у соответствующих заданий.` : `Домашнее задание к ${dayMonth(page.targetDate)}. Выполненное заранее уже будет видно у своего задания.`}</p>
      <div className="day-summary"><strong>{pending}</strong><span>{pending === 1 ? 'действие к этой дате осталось' : 'действий к этой дате осталось'}</span>{dayTests.length > 0 && <><span className="day-summary-separator">·</span><span>{dayTests.filter((test) => test.status === 'submitted').length} из {dayTests.length} тестов завершено</span></>}</div>
    </section>

    <div className="day-tabs" role="tablist" aria-label="Раздел страницы дня">
      <button role="tab" aria-selected={view === 'school'} className={view === 'school' ? 'active' : ''} onClick={() => { setManualView(true); setView('school') }}>Расписание</button>
      <button role="tab" aria-selected={view === 'homework'} className={view === 'homework' ? 'active' : ''} onClick={() => { setManualView(true); setView('homework') }}>Домашнее задание на {dayMonth(page.targetDate)}</button>
    </div>
    {error && <div className="day-inline-error" role="alert">{error}</div>}

    {view === 'school' ? <section className="day-schedule-panel">
      <h2>Расписание · {shortDate(page.date)}</h2>
      <p>Проводимые уроки по МЭШ с учётом семейных уточнений.{page.gradeAsOf && ` Средние оценки — по срезу на ${dayMonth(page.gradeAsOf)}.`}</p>
      <div className="day-timeline">{page.todaySchedule.map((lesson, index) => {
        const id = scheduleGradeIds[lesson.subject]
        const summary = page.gradeSummary.find((item) => item.id === id)
        const grade = page.grades?.find((item) => item.id === id)
        return <div className="day-lesson" key={`${lesson.start}-${index}`}><time>{lesson.start}<br />{lesson.end}</time><div className="day-lesson-main"><div className="day-lesson-heading"><strong>{lesson.subject}</strong><GradeBadge summary={summary} details={grade} threshold={page.workingThreshold} asOf={page.gradeAsOf} /></div>{lesson.homework && <p>{lesson.homework}</p>}</div></div>
      })}</div>
      <h3>Завтра в школе</h3>
      <div className="day-next-schedule">{page.targetSchedule.map((lesson, index) => <span key={`${lesson.start}-${index}`}>{lesson.start} {lesson.subject}</span>)}</div>
    </section> : <>
      {parent && page.parentNotes?.[0] && <section className="day-attention"><h2>ДЗ на {dayMonth(page.targetDate)}</h2><p>{page.parentNotes[0]}</p></section>}
      {parent && (currentAdded.length > 0 || currentChanged.length > 0) && <section className="day-attention"><h2>Изменения ДЗ на {dayMonth(page.targetDate)}</h2><p>Добавлено действий: {currentAdded.length}. Уточнено: {currentChanged.length}.</p></section>}
      {page.notices[0] && !parent && <div className="day-notices"><p>✳ {page.notices[0]}</p></div>}
      <h2 className="day-homework-heading">Домашнее задание на {dayMonth(page.targetDate)}</h2>
      {currentSubjects.length === 0 && <div className="day-notices"><p>На эту дату задания в МЭШ пока не указаны.</p></div>}

      <div className="day-subject-list">{currentSubjects.map((subject) => {
        const summary = page.gradeSummary.find((item) => item.id === subject.id)
        const grade = page.grades?.find((item) => item.id === subject.id)
        const subjectPlacements = currentPlacements.filter((placement) => placement.subjectId === subject.id)
        const lineages = subjectPlacements.map((placement) => ({ placement, chain: quizChain(tests.find((item) => item.token === placement.token), tests) })).filter(({ chain }) => chain.length > 1)
        const lineageByToken = new Map(lineages.map(({ placement, chain }) => [placement.token, chain]))
        return <section className={`day-subject day-subject-${subject.id}`} key={subject.id}>
          <div className="day-subject-head"><span className="day-subject-icon">{subject.icon}</span><div className="day-subject-title"><h2>{subject.name}</h2><p>{subject.materials}</p></div>
            <GradeBadge summary={summary} details={grade} threshold={page.workingThreshold} asOf={page.gradeAsOf} /></div>
          <div className="day-subject-content"><p className="day-subject-summary">{subject.summary}</p>
            {parent && <details className="day-mesh"><summary>Как записано в МЭШ</summary><p>{subject.mesh}</p></details>}
            <div className="day-task-list">{lineages.map(({ placement, chain }) => {
              const task = subject.tasks.find((item) => item.testToken === placement.token)
              const materialLinks = task ? [...new Map([
                ...(page.materialLinks?.[task.id] ?? []),
                ...(page.taskPageRefs?.[task.id] ?? []).map((ref) => catalogPages[ref]).filter((link): link is DayMaterialLink => Boolean(link)),
              ].map((link) => [link.sourceRef || link.url, link])).values()] : []
              return <QuizLineageCard key={`lineage-${placement.token}`} chain={chain} parent={parent} task={task} materialLinks={materialLinks} />
            })}
            {subject.tasks.map((task) => {
              if (task.testToken && lineageByToken.has(task.testToken)) return null
              const taskLinks = [...new Map([
                ...(page.materialLinks?.[task.id] ?? []),
                ...(page.taskPageRefs?.[task.id] ?? []).map((ref) => catalogPages[ref]).filter((link): link is DayMaterialLink => Boolean(link)),
              ].map((link) => [link.sourceRef || link.url, link])).values()]
              const readerGroups = taskLinks.filter(canReadInside).reduce<DayMaterialLink[][]>((groups, link) => {
                const key = `${link.sourceType}:${link.title.replace(/,\s*стр\.\s*\d+\s*$/, '')}`
                const existing = groups.find((group) => `${group[0].sourceType}:${group[0].title.replace(/,\s*стр\.\s*\d+\s*$/, '')}` === key)
                if (existing) existing.push(link)
                else groups.push([link])
                return groups
              }, [])
              const otherLinks = taskLinks.filter((link) => !canReadInside(link))
              const needsTextbook = task.materialStatus?.state === 'textbook-page-needed' && !taskLinks.some((link) => link.sourceType === 'textbook-page')
              const taskUploads = uploads.filter((upload) => uploadMatchesTask(upload, task.id))
              const cdzTask = task.kind === 'check' && (task.id.endsWith('-cdz') || task.title.includes('ЦДЗ'))
              const review = reviews.find((item) => item.taskId === task.id)
              const processing = activeProcessing(review, taskUploads)
              const taskStatus = review?.status && review.status !== 'cannot-assess' ? review.status : task.status
              const localTaskPhotos = localPhotos.filter((photo) => photo.taskId === task.id)
              const priorWork = taskUploads.some((upload) => upload.status === 'reviewed')
              const newWork = taskUploads.some((upload) => upload.status === 'pending') || localTaskPhotos.some((photo) => photo.state === 'saved' && !taskUploads.some((upload) => upload.id === `${studentToken}:${photo.id}`))
              const uploadingWork = taskUploads.some((upload) => ['requested', 'awaiting-upload', 'uploaded'].includes(upload.status)) || localTaskPhotos.some((photo) => photo.state === 'uploading')
              const linkedTest = tests.find((item) => item.token === task.testToken)
              const readPassed = task.kind === 'read' && linkedTest?.status === 'submitted' && linkedTest.points != null && linkedTest.points >= (task.requiredPoints ?? linkedTest.maxPoints ?? 1)
              const verified = taskStatus === 'verified' || readPassed
              const submitted = (task.kind === 'written' || task.kind === 'check') && newWork
              const state = task.problems?.length ? `${task.problems.length} задач · каждая проверяется отдельно` : task.kind === 'written'
                ? taskStatus === 'verified' ? 'Готово · проверено' : processing ? 'Проверяем работу' : newWork ? 'Новое фото · ждёт проверки' : uploadingWork ? 'Фото загружается' : priorWork ? taskStatus === 'needs-fix' ? 'Работа проверена · исправить' : taskStatus === 'partial' ? 'Работа проверена · дополнить' : 'Работа сохранена' : statusLabel(taskStatus)
                : task.kind === 'read' ? readPassed ? `Чтение подтверждено · ${linkedTest?.points}/${linkedTest?.maxPoints} верно` : linkedTest?.status === 'submitted' ? linkedTest.points == null ? 'Проверяем тест' : `Нужен разбор · ${linkedTest.points}/${linkedTest.maxPoints}` : 'Нужен тест' : cdzTask ? task.platformResult?.state === 'completed' ? `ЦДЗ пройдено · ${task.platformResult.points}/${task.platformResult.maxPoints}` : processing ? 'Проверяем результат ЦДЗ' : newWork ? 'Результат ЦДЗ получен · ждёт проверки' : uploadingWork ? 'Фото загружается' : 'Ожидает результата ЦДЗ' : statusLabel(taskStatus)
              const uploadLabel = cdzTask ? newWork || uploadingWork ? 'Добавить ещё фото ЦДЗ' : 'Загрузить результат ЦДЗ' : newWork || uploadingWork ? 'Добавить ещё фото' : priorWork ? taskStatus === 'needs-fix' ? 'Добавить фото исправления' : 'Добавить фото продолжения' : 'Добавить фото ответа'
              const canUpload = !task.problems?.length && !parent && (task.kind === 'written' && taskStatus !== 'verified' && (!priorWork || newWork || uploadingWork || taskStatus === 'needs-fix' || taskStatus === 'partial') || cdzTask && taskStatus !== 'verified')
              const showSubmission = !task.problems?.length && task.kind === 'written' && taskStatus !== 'verified' && (!priorWork || newWork || uploadingWork || taskStatus === 'needs-fix' || taskStatus === 'partial')
              const submission = task.submission
              const taskCard = <article className={`day-task ${verified ? 'done' : submitted ? 'submitted' : ''}`} key={task.id}>
                <div className="day-task-row"><span className={`day-task-state ${verified ? 'verified' : submitted ? 'partial' : taskStatus}`}>{verified && <CheckCircle2 size={15} aria-hidden="true" />} {state}</span>{task.kind === 'written' && <span className="day-task-type">В тетради</span>}{task.originDate && task.originDate !== page.targetDate && <span className="day-task-type">Осталось с {dayMonth(task.originDate)}</span>}</div>
                <h3>{task.title}</h3><p>{task.detail}</p>
                {task.instructionStatus?.state === 'needs-review' && <p className="day-material-warning">⚠️ {task.instructionStatus.message} Подтверждена только запись МЭШ выше; дополнительных пунктов нет.</p>}
                <WorkReview review={review} uploads={taskUploads} />
                {!!task.steps?.length && <ol className="day-task-steps">{task.steps.map((step, index) => <Instruction key={index} item={step} index={index} />)}</ol>}
                {needsTextbook && <p className="day-material-warning">📖 {task.materialStatus?.message}</p>}
                {(task.materialStatus?.state === 'text-absent-from-textbook' || task.materialStatus?.state === 'no-textbook') && <p className="day-material-warning">📖 {task.materialStatus.message}</p>}
                {readerGroups.map((group) => <MaterialReader key={group[0].url} links={group} parent={parent} statement={Boolean(task.problems?.length && group[0].sourceType === 'teacher-attachment')} />)}
                {otherLinks.length > 0 && <div className="day-material-links">{otherLinks.map((material) => <div className="day-material-source" key={material.url}><a href={material.url} target="_blank" rel="noopener noreferrer">{material.sourceType === 'textbook-page' ? 'Страница учебника' : material.sourceType === 'teacher-attachment' ? 'Файл учителя' : material.sourceType === 'external-text' ? 'Внешний текст, не из учебника' : 'Материал'}: {material.title} <ExternalLink size={13} aria-hidden="true" /></a>{material.reason && <small>{material.reason}</small>}{material.sourceQuote && <small>Из учебника: «{material.sourceQuote.trim()}»</small>}{parent && material.sourceRef && <small>{material.sourceRef} · PDF {material.pdfPage} · учебник {material.printedPage}</small>}</div>)}</div>}
                {!!task.problems?.length && <div className="day-problem-list" aria-label={`Задачи: ${task.title}`}>
                  <h4>Задания из листа · {task.problems.length}</h4>
                  {task.problems.map((problem) => {
                    const problemUploads = uploads.filter((upload) => uploadMatchesTask(upload, problem.id))
                    const problemPhotos = localPhotos.filter((photo) => photo.taskId === problem.id)
                    const problemReview = reviews.find((item) => item.taskId === problem.id)
                    const state = problemCardState(problemUploads, problemReview, problemPhotos.some((photo) => photo.state === 'uploading'), statusNow)
                    return <ProblemTaskCard problem={problem} state={state} key={problem.id} links={taskLinks} parent={parent} help={helpRequests.find((item) => item.taskId === problem.id)} review={problemReview} uploads={problemUploads} helpAccess={helpRole === 'checking' ? 'checking' : helpRole === 'student' ? 'ready' : 'login-required'} onRequestHelp={!parent && helpRole === 'student' ? (taskId, revision) => requestDayHelp(studentToken, taskId, revision) : undefined} onPhotos={(files) => attach(problem, files)}>
                      <PhotoStrip taskTitle={`№ ${problem.number}. ${problem.title}`} studentToken={studentToken} uploads={problemUploads} localPhotos={problemPhotos} review={problemReview} now={statusNow} onRetry={queuePhotoUpload} onDelete={deletePhoto} />
                    </ProblemTaskCard>
                  })}
                </div>}
                {showSubmission && <div className="day-submission-instructions">
                  <strong>{priorWork && (taskStatus === 'needs-fix' || taskStatus === 'partial') ? 'Что исправить и сфотографировать' : 'Что сфотографировать'}</strong>
                  {submission?.lead && <p>{submission.lead}</p>}
                  {!!submission?.items?.length && <ol>{submission.items.map((item, index) => <Instruction key={index} item={item} index={index} />)}</ol>}
                  {submission?.photo && <p className="day-submission-photo"><b>На фото</b><span>{submission.photo}</span></p>}
                  {!submission?.lead && !submission?.items?.length && !submission?.photo && <p>{submission?.description ?? `Страница тетради с результатом задания «${task.title}». Номер и ответ должны читаться.`}</p>}
                </div>}
                <div className="day-task-actions">
                  {canUpload && <label className="day-upload"><Camera size={17} aria-hidden="true" /> {uploadLabel}<input type="file" accept="image/*" multiple onChange={(event) => { attach(task, Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} /></label>}
                  {task.kind === 'read' && task.testToken && task.testSlug && <a className="day-quiz-link" href={parent && linkedTest?.status !== 'submitted' && linkedTest?.previewToken ? `#/preview/${task.testSlug}~${linkedTest.previewToken}` : `#/t/${task.testSlug}~${task.testToken}`}>{parent ? linkedTest?.status === 'submitted' ? 'Посмотреть результат' : 'Посмотреть вопросы' : linkedTest?.status === 'submitted' ? 'Посмотреть результат' : linkedTest?.answered ? 'Продолжить тест' : 'Пройти короткий тест'} <ExternalLink size={15} /></a>}
                  {parent && !task.problems?.length && <span className="day-parent-status">{task.kind === 'written' ? taskStatus === 'verified' ? 'Работа проверена' : newWork ? 'Новая загрузка ожидает проверки' : priorWork ? 'Работа разобрана; подробности выше' : 'Подтверждённого фото пока нет' : task.kind === 'read' ? readPassed ? 'Чтение подтверждено тестом' : 'Чтение тестом пока не подтверждено' : cdzTask ? task.platformResult?.state === 'completed' ? `Подтверждено результатом МЭШ: ${task.platformResult.points}/${task.platformResult.maxPoints} баллов` : newWork ? 'Результат ЦДЗ ожидает проверки' : 'Результат ЦДЗ пока не подтверждён' : 'Статус сдачи не сообщён'}</span>}
                </div>
                {task.kind === 'read' && linkedTest && <TestProgress test={linkedTest} />}
                <PhotoStrip taskTitle={task.title} evidenceLabel={cdzTask ? 'Подтверждение ЦДЗ' : 'Фото работы'} studentToken={studentToken} uploads={taskUploads} localPhotos={localTaskPhotos} review={review} now={statusNow} onRetry={queuePhotoUpload} onDelete={deletePhoto} />
                {parent && <small className="day-source"><BookOpen size={14} /> {task.source}</small>}
              </article>
              if (!task.problems?.length) return taskCard
              /** @see ../docs/product/day-page.md#completed-problem-group */
              const problemIds = new Set(task.problems.map((problem) => problem.id))
              const localPendingCount = localPhotos.filter((photo) => problemIds.has(photo.taskId) && !uploads.some((upload) => upload.id === `${studentToken}:${photo.id}` && upload.status === 'reviewed')).length
              const sourceCount = new Set(taskLinks.filter((link) => link.sourceType === 'teacher-attachment').map((link) => link.url)).size
              return <ProblemGroup key={task.id} id={task.id} title={subject.name} problems={task.problems} uploads={uploads} reviews={reviews} localPendingCount={localPendingCount} sourceCount={sourceCount} ready={evidenceReady}>{taskCard}</ProblemGroup>
            })}
            {currentPlacements.filter((placement) => placement.subjectId === subject.id && !placement.taskId).map((placement) => {
              const test = tests.find((item) => item.token === placement.token)
              const chain = lineageByToken.get(placement.token)
              if (chain) return null
              return <article className={`day-task day-quiz-task ${test?.status === 'submitted' ? 'done' : ''}`} key={placement.token}>
                <div className="day-task-row"><span className={`day-task-state ${test?.status === 'submitted' ? 'verified' : ''}`}>{test?.status === 'submitted' ? 'Тест завершён' : test?.answered ? 'Тест в процессе' : 'Тест не пройден'}</span><span className="day-task-type">Самопроверка</span></div>
                <h3>{test?.title ?? 'Загружаем тест…'}</h3>
                {test && <><TestProgress test={test} /><a className="day-quiz-link" href={parent && test.status !== 'submitted' && test.previewToken ? `#/preview/${test.slug}~${test.previewToken}` : `#/t/${test.slug}~${test.token}`}>{parent ? test.status === 'submitted' ? 'Посмотреть результат' : 'Посмотреть вопросы' : test.status === 'submitted' ? 'Мой результат' : test.answered ? 'Продолжить тест' : 'Пройти тест'} <ExternalLink size={15} /></a></>}
              </article>
            })}</div>
          </div>
        </section>
      })}</div>
      {noSpecialHomework && <p className="day-no-homework">Спецкурс по математике: в МЭШ на {dayMonth(page.targetDate)} домашнее задание не указано.</p>}
    </>}
    <footer className="day-footer"><Clock3 size={15} /> МЭШ: снимок {new Date(page.meshFetchedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}. Работы и тесты обновляются при открытой странице.</footer>
  </div></>
}
