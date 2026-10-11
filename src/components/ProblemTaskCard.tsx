import type { ReactNode } from 'react'
import type { DayHelp, DayMaterialLink, DayProblem, DayUpload, DayWorkReview } from '@/lib/dayStore'
import type { ProblemCardState } from '@/lib/reviewPresentation'
import { ProblemCard, ProblemUploadButton } from './ProblemCard'
import ProblemStatement from './ProblemStatement'
import WorkReview from './WorkReview'

/** Shared numbered task view; the photo gallery is supplied by its route. @see ../../docs/product/adaptive-problem-card.md#shared-problem-view */
export default function ProblemTaskCard({ problem, state, links, parent, help, review, uploads, accepted, canDecide, onDecision, helpAccess, onRequestHelp, onPhotos, children }: {
  problem: DayProblem; state: ProblemCardState; links: DayMaterialLink[]; parent: boolean; help?: DayHelp;
  review?: DayWorkReview; uploads: DayUpload[]; accepted?: boolean; canDecide?: boolean; onDecision?: (action: 'accept' | 'reopen') => Promise<void>; helpAccess: 'checking' | 'ready' | 'login-required';
  onRequestHelp?: (taskId: string, revision: number, requestKind: NonNullable<DayHelp['requestKind']>, requestText: string) => Promise<void>; onPhotos: (files: File[]) => void; children?: ReactNode;
}) {
  return <ProblemCard problem={problem} state={state}>
    <ProblemStatement problem={problem} links={links} parent={parent} help={help} review={review} finished={accepted} helpAccess={helpAccess} onRequestHelp={onRequestHelp} />
    <WorkReview review={review} uploads={uploads} accepted={accepted} canDecide={canDecide && !uploads.some((upload) => upload.status === 'pending')} onDecision={onDecision} />
    <div className="problem-card-actions">{parent ? !uploads.length && <small>Фото по этому номеру пока нет</small> : !accepted && <ProblemUploadButton correction={review?.status === 'needs-fix' || review?.status === 'partial'} onPhotos={onPhotos} />}</div>
    {children}
  </ProblemCard>
}
