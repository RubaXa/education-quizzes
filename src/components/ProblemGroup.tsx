/** @see ../../docs/decisions/collapsed-variant-status-2026-10-21.md */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Camera, ChevronDown, FileText } from 'lucide-react'
import type { DayProblem, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { summarizeProblemGroup } from '@/lib/problemGroupSummary'
import type { ParentCompletionEvent } from '@/lib/parentCompletion'
import StatusIcon from './StatusIcon'
import './ProblemGroup.css'

/** @see ../../docs/modules/school-diary/day-page.md#completed-problem-group
 * @see ../../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet
 * @see ../../docs/shared/design/statuses.md#components */
export default function ProblemGroup({ id, title, subtitle, problems, requiredProblems = problems, numberLabel, uploads, reviews, decisions = [], localPendingCount, requiredLocalPendingCount, sourceCount, ready, focusTaskId, defaultOpen = false, children }: {
  id: string; title: string; subtitle?: string; problems: DayProblem[]; requiredProblems?: DayProblem[]; numberLabel?: string; uploads: DayUpload[]; reviews: DayWorkReview[];
  decisions?: ParentCompletionEvent[];
  localPendingCount: number; requiredLocalPendingCount?: number; sourceCount: number; ready: boolean; focusTaskId?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const summary = summarizeProblemGroup(problems, uploads, reviews, localPendingCount, ready, decisions)
  const requiredSummary = summarizeProblemGroup(requiredProblems, uploads, reviews, requiredLocalPendingCount ?? localPendingCount, ready, decisions)
  const focused = focusTaskId === id || problems.some((problem) => problem.id === focusTaskId)
  // @see ../../docs/modules/school-diary/day-page.md#completed-problem-group
  // A sheet is compact on entry; an explicit deep link still reveals its target.
  const open = manualOpen ?? (focused || defaultOpen)
  const bodyId = `problem-group-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return <section className={`problem-group ${summary.tone}`}>
    <button className="problem-group-toggle" type="button" aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? 'Свернуть' : 'Развернуть'} ${title}; ${ready ? `${summary.completedCount} из ${summary.total} проверено${summary.needsFixCount ? `, ${summary.needsFixCount} требуют исправления` : ''}${requiredProblems.length ? `; обязательная часть ${requiredSummary.completedCount} из ${requiredSummary.total}` : ''}` : 'загружаем результаты'}`} onClick={() => setManualOpen(!open)}>
      <span className="problem-group-top"><strong>{title}</strong>{!open && <span className="problem-group-badge" aria-label={ready ? `${summary.completedCount} из ${summary.total} проверено${summary.needsFixCount ? `, ${summary.needsFixCount} требуют исправления` : ''}${requiredProblems.length ? `; обязательная часть ${requiredSummary.completedCount} из ${requiredSummary.total}` : ''}` : 'Загружаем'}><StatusIcon size={16} status={!ready ? 'processing' : summary.tone === 'success' ? 'complete' : summary.tone === 'partial' ? 'partial' : summary.tone === 'error' ? 'needs-fix' : summary.tone === 'working' ? 'waiting' : 'ready'} />{ready ? `${summary.completedCount} из ${summary.total}${summary.needsFixCount ? ` · исправить ${summary.needsFixCount}` : ''}` : 'Загружаем…'}</span>}<ChevronDown className="problem-group-chevron" size={18} aria-hidden="true" /></span>
      {subtitle && <span className="problem-group-subtitle">{subtitle}</span>}
      {!subtitle && (open || summary.tone !== 'neutral') && <span className="problem-group-conclusion">{summary.conclusion}</span>}
      {!subtitle && open && <span className="problem-group-meta"><span>{numberLabel ?? `№ ${summary.numbers}`}</span><span><Camera size={14} aria-hidden="true" />{summary.photoCount ? `${summary.photoCount} фото работы` : summary.activeCount ? 'Фото загружается' : 'Фото ещё нет'}</span>{sourceCount > 0 && <span><FileText size={14} aria-hidden="true" />{sourceCount === 1 ? 'Лист учителя' : `${sourceCount} файла учителя`}</span>}</span>}
    </button>
    <div id={bodyId} className="problem-group-body" hidden={!open}>{open && children}</div>
  </section>
}
