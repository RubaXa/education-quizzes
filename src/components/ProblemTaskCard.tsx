import {reviewConversationFor} from '@/lib/reviewConversation'
import { useEffect, type ReactNode } from 'react'
import { reportRoleProjection } from '@/lib/roleDiagnostics'
import type { DayHelp, DayMaterialLink, DayProblem, DaySourceResearch, DayUpload, DayWorkReview, ParentTaskGuide as ParentTaskGuideData } from '@/lib/dayStore'
import type { ProblemCardState } from '@/lib/reviewPresentation'
import type { ParentCompletionEvent } from '@/lib/parentCompletion'
import { ProblemCard, ProblemUploadButton } from './ProblemCard'
import ProblemStatement from './ProblemStatement'
import WorkReview from './WorkReview'
import ParentTaskGuide from './ParentTaskGuide'
import TaskGuidance from './TaskGuidance'
import type { DayGuidance } from '@/lib/dayGuidance'

/** Shared numbered task view; the photo gallery is supplied by its route.
 * @see ../../docs/modules/reviews/adaptive-problem-card.md#shared-problem-view
 * @see ../../docs/modules/reviews/problem-card-design-decisions.md#role-projection */
export default function ProblemTaskCard({ studentToken, problem, state, links, parent, owner, help, review, guide, guidance, guidanceReady, onSendGuidance, sourceResearch, uploads, accepted, canDecide, onDecision, decisions, onRequirementChoice, onStageChoice, helpAccess, onRequestHelp, onPhotos, children }: {
  studentToken?:string; owner?: { familyId?: string; childId?: string };
  problem: DayProblem; state: ProblemCardState; links: DayMaterialLink[]; parent: boolean; help?: DayHelp; guide?: ParentTaskGuideData; guidance?: DayGuidance[]; guidanceReady?: boolean; onSendGuidance?: (stage: ParentTaskGuideData['stages'][number], level: 'hint' | 'reveal') => Promise<void>; sourceResearch?: DaySourceResearch;
  review?: DayWorkReview; uploads: DayUpload[]; accepted?: boolean; canDecide?: boolean; onDecision?: (action: 'accept' | 'reopen') => Promise<void>; decisions?: ParentCompletionEvent[]; onRequirementChoice?: (id: string, action: 'require' | 'optional') => Promise<void>; onStageChoice?: (stage: ParentTaskGuideData['stages'][number], required: boolean) => Promise<void>; helpAccess: 'checking' | 'ready' | 'login-required';
  onRequestHelp?: (taskId: string, revision: number, requestKind: NonNullable<DayHelp['requestKind']>, requestText: string) => Promise<void>; onPhotos: (files: File[]) => void; children?: ReactNode;
}) {
  const hasGuide = Boolean(guide)
  const familyId = owner?.familyId, childId = owner?.childId
  useEffect(() => { reportRoleProjection({ familyId, childId }, parent, hasGuide) }, [familyId, childId, parent, hasGuide])
  return <ProblemCard problem={problem} state={state} parent={parent} sourceResearch={sourceResearch}>
    <ProblemStatement problem={problem} links={links} parent={parent} help={help} review={review} finished={accepted} helpAccess={helpAccess} onRequestHelp={onRequestHelp} />
    {!parent && <TaskGuidance items={guidance ?? []} />}
    {parent && guide && <ParentTaskGuide guide={guide} review={review} decisions={decisions} guidance={guidance} guidanceReady={guidanceReady} onSend={onSendGuidance} onStageChoice={onStageChoice} />}
    <WorkReview conversation={studentToken?reviewConversationFor(studentToken,review,!parent&&helpAccess==='ready',Boolean(guidanceReady),help,guidance??[]):undefined} review={review} uploads={uploads} accepted={accepted} canDecide={canDecide && !uploads.some((upload) => upload.status === 'pending')} onDecision={onDecision} decisions={decisions} onRequirementChoice={onRequirementChoice} parent={parent} />
    {!parent && <div className="problem-card-actions"><ProblemUploadButton correction={accepted || review?.status === 'needs-fix' || review?.status === 'partial'} onPhotos={onPhotos} /></div>}
    {children}
  </ProblemCard>
}
