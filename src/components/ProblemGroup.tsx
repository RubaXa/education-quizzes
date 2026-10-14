import { useState } from 'react'
import type { ReactNode } from 'react'
import { Camera, CheckCircle2, ChevronDown, FileText } from 'lucide-react'
import type { DayProblem, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { summarizeProblemGroup } from '@/lib/problemGroupSummary'
import type { ParentCompletionEvent } from '@/lib/parentCompletion'
import './ProblemGroup.css'

/** @see ../../docs/product/day-page.md#completed-problem-group */
export default function ProblemGroup({ id, title, problems, requiredProblems = problems, numberLabel, uploads, reviews, decisions = [], localPendingCount, sourceCount, ready, focusTaskId, children }: {
  id: string; title: string; problems: DayProblem[]; requiredProblems?: DayProblem[]; numberLabel?: string; uploads: DayUpload[]; reviews: DayWorkReview[];
  decisions?: ParentCompletionEvent[];
  localPendingCount: number; sourceCount: number; ready: boolean; focusTaskId?: string; children: ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const summary = summarizeProblemGroup(requiredProblems, uploads, reviews, localPendingCount, ready, decisions)
  const focused = focusTaskId === id || problems.some((problem) => problem.id === focusTaskId)
  // @see ../../docs/product/day-page.md#completed-problem-group
  // A sheet is compact on entry; an explicit deep link still reveals its target.
  const open = manualOpen ?? focused
  const bodyId = `problem-group-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return <section className={`problem-group ${summary.tone}`}>
    <button className="problem-group-toggle" type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setManualOpen(!open)}>
      <span className="problem-group-top"><strong>{title}</strong><span className="problem-group-badge" aria-label={ready ? summary.total ? `${summary.completedCount} из ${summary.total} завершено` : 'Все варианты по желанию' : 'Загружаем'}>{summary.complete && <CheckCircle2 size={16} aria-hidden="true" />}{ready ? summary.total ? `${summary.completedCount} из ${summary.total}` : 'По желанию' : 'Загружаем…'}</span></span>
      <span className="problem-group-conclusion">{summary.conclusion}</span>
      <span className="problem-group-meta"><span>{numberLabel ?? `№ ${summary.numbers}`}</span><span><Camera size={14} aria-hidden="true" />{summary.photoCount ? `${summary.photoCount} фото работы` : summary.activeCount ? 'Фото загружается' : 'Фото ещё нет'}</span>{sourceCount > 0 && <span><FileText size={14} aria-hidden="true" />{sourceCount === 1 ? 'Лист учителя' : `${sourceCount} файла учителя`}</span>}</span>
      <span className="problem-group-action">{open ? 'Свернуть' : 'Открыть лист, решения и проверки'} <ChevronDown size={17} aria-hidden="true" /></span>
    </button>
    <div id={bodyId} className="problem-group-body" hidden={!open}>{open && children}</div>
  </section>
}
