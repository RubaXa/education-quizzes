import { useState } from 'react'
import type { ReactNode } from 'react'
import { Camera, CheckCircle2, ChevronDown, FileText } from 'lucide-react'
import { uploadMatchesTask } from '@/lib/dayStore'
import type { DayProblem, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { summarizeProblemGroup } from '@/lib/problemGroupSummary'
import './ProblemGroup.css'

/** @see ../../docs/product/day-page.md#completed-problem-group */
export default function ProblemGroup({ id, title, problems, uploads, reviews, localPendingCount, sourceCount, ready, children }: {
  id: string; title: string; problems: DayProblem[]; uploads: DayUpload[]; reviews: DayWorkReview[];
  localPendingCount: number; sourceCount: number; ready: boolean; children: ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState<{ evidenceKey: string; open: boolean } | null>(null)
  const summary = summarizeProblemGroup(problems, uploads, reviews, localPendingCount, ready)
  const evidenceKey = [
    ...uploads.filter((upload) => problems.some((problem) => uploadMatchesTask(upload, problem.id))).map((upload) => `${upload.id}:${upload.status}`),
    ...reviews.filter((review) => problems.some((problem) => review.taskId === problem.id)).map((review) => `${review.taskId}:${review.status}:${review.uploadIds?.join(',')}:${review.summary}:${review.mathReasoning?.answer}:${review.mathReasoning?.argument}`),
    String(localPendingCount),
  ].join('|')
  const open = manualOpen?.evidenceKey === evidenceKey ? manualOpen.open : ready && !summary.complete
  const bodyId = `problem-group-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return <section className={`problem-group ${summary.tone}`}>
    <button className="problem-group-toggle" type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setManualOpen({ evidenceKey, open: !open })}>
      <span className="problem-group-top"><strong>{title}</strong><span className="problem-group-badge">{summary.complete && <CheckCircle2 size={16} aria-hidden="true" />}{ready ? `${summary.verifiedCount} из ${summary.total} подтверждено` : 'Загружаем…'}</span></span>
      <span className="problem-group-conclusion">{summary.conclusion}</span>
      <span className="problem-group-meta"><span>№ {summary.numbers}</span><span><Camera size={14} aria-hidden="true" />{summary.photoCount ? `${summary.photoCount} фото работы` : summary.activeCount ? 'Фото загружается' : 'Фото ещё нет'}</span>{sourceCount > 0 && <span><FileText size={14} aria-hidden="true" />{sourceCount === 1 ? 'Лист учителя' : `${sourceCount} файла учителя`}</span>}</span>
      <span className="problem-group-action">{open ? 'Свернуть' : 'Открыть лист, решения и проверки'} <ChevronDown size={17} aria-hidden="true" /></span>
    </button>
    <div id={bodyId} className="problem-group-body" hidden={!open}>{open && children}</div>
  </section>
}
