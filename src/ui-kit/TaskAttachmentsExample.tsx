/** Canonical task controls with local fixtures; no independent control CSS or server writes.
 * @see ../../docs/shared/design/ui-kit.md#вложения-в-карточке-задания */
import { useEffect, useRef, useState } from 'react'
import type { DayProblem, DayUpload } from '@/lib/dayStore'
import { problemCardState } from '@/lib/reviewPresentation'
import { workFileContentType } from '../../storage/work-file-types.mjs'
import ProblemGroup from '@/components/ProblemGroup'
import ProblemTaskCard from '@/components/ProblemTaskCard'
import TaskWorkEvidence from '@/components/TaskWorkEvidence'
import '../WeekendMathSlot.css'

type FileState = 'pending' | 'reviewed' | 'upload-error'
export default function TaskAttachmentsExample({ problem, photoSource }: { problem: DayProblem; photoSource: string }) {
  const [layout, setLayout] = useState<'day' | 'weekend'>('day')
  const [parent, setParent] = useState(false)
  const blobUrls = useRef<string[]>([])
  const task = { ...problem, id: 'demo-task-attachments' }
  function examples(status: FileState = 'pending'): DayUpload[] {
    const received = '2026-10-31T15:00:00.000Z'
    return [
      { id: 'demo:attachment-photo', taskId: task.id, status: status === 'upload-error' ? 'pending' : status, originalName: 'Решение.jpg', contentType: 'image/jpeg', dataUrl: photoSource, storage: { provider: 'yandex-disk', state: 'stored', path: 'demo/work.jpg', size: 1, syncedAt: received } },
      { id: 'demo:attachment-pdf', taskId: task.id, status, originalName: 'Решение.pdf', contentType: 'application/pdf', ...(status === 'upload-error' ? { error: 'Условная ошибка передачи файла' } : { storage: { provider: 'yandex-disk' as const, state: 'stored' as const, path: 'demo/work.pdf', size: 1, syncedAt: received } }) },
      { id: 'demo:attachment-docx', taskId: task.id, status: status === 'upload-error' ? 'pending' : status, originalName: 'Пояснение.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage: { provider: 'yandex-disk', state: 'stored', path: 'demo/work.docx', size: 1, syncedAt: received } },
    ]
  }
  const [uploads, setUploads] = useState<DayUpload[]>(() => examples())
  useEffect(() => () => blobUrls.current.forEach(url => URL.revokeObjectURL(url)), [])
  function addFiles(files: File[]) {
    const added = files.map(file => {
      const dataUrl = URL.createObjectURL(file); blobUrls.current.push(dataUrl)
      return { id: `demo:${crypto.randomUUID()}`, taskId: task.id, status: 'pending' as const, contentType: workFileContentType(file), originalName: file.name, dataUrl }
    })
    setUploads(current => [...current, ...added])
  }
  const taskCard = <ProblemTaskCard problem={task} state={problemCardState(uploads, undefined)} links={[]} parent={parent} uploads={uploads} helpAccess="login-required" onPhotos={addFiles}>
    <TaskWorkEvidence layout={layout} taskId={task.id} taskTitle={`№ ${task.number}. ${task.title}`} studentToken="demo" uploads={uploads} localPhotos={[]} now={Date.now()} pages={[]} onDelete={layout === 'day' || !parent ? async id => setUploads(current => current.filter(upload => upload.id !== id)) : undefined} />
  </ProblemTaskCard>
  const sheet = <ProblemGroup id="demo-attachment-sheet" title="Письменная работа · пример" subtitle="Условный пример вложений" problems={[task]} uploads={uploads} reviews={[]} localPendingCount={0} sourceCount={0} ready defaultOpen>
    {layout === 'day' ? <article className="day-task has-problems">{taskCard}</article> : <div className="weekend-math-group"><div className="weekend-math-problems">{taskCard}</div></div>}
  </ProblemGroup>
  return <section aria-label="Вложения в карточке задания">
    <h3>Вложения в карточке задания</h3>
    <p>Обычная галерея дня и компактная галерея выходного листа показаны отдельно. Используются действующие карточка, загрузка и состав вложений; данные условные, изменения остаются только в этом примере.</p>
    <div className="edu-kit-presets" aria-label="Место карточки"><button type="button" aria-pressed={layout === 'day'} onClick={() => setLayout('day')}>Карточка дня</button><button type="button" aria-pressed={layout === 'weekend'} onClick={() => setLayout('weekend')}>Выходной лист</button></div>
    <div className="edu-kit-presets" aria-label="Роль во вложениях"><button type="button" aria-pressed={!parent} onClick={() => setParent(false)}>Ученик</button><button type="button" aria-pressed={parent} onClick={() => setParent(true)}>Родитель</button></div>
    <div className="edu-kit-presets" aria-label="Состояние вложений"><button type="button" onClick={() => setUploads(examples())}>Получено</button><button type="button" onClick={() => setUploads(examples('reviewed'))}>Проверено</button><button type="button" onClick={() => setUploads(examples('upload-error'))}>Ошибка файла</button></div>
    {layout === 'day' ? <section className="day-subject day-subject-math has-numbered-sheet"><div className="day-subject-content">{sheet}</div></section> : <section className="weekend-math-slot">{sheet}</section>}
  </section>
}
