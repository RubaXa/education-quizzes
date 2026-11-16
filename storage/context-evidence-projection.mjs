/** @see ../docs/decisions/assignment-source-audit-corrections-2026-11-16.md */
/** Browser-safe receipt fields; no grading data or server dependencies.
 * @see ../docs/modules/reviews/review-criteria-provenance.md#context-evidence */
export const contextEvidenceFields=['type','title','points','maxPoints','duration','observedDate','uploadId','location','summary']
export function contextEvidenceProjection(receipts){
 if(!Array.isArray(receipts))return []
 return receipts.filter(r=>r?.purpose==='context-evidence').map(r=>Object.fromEntries(['id','purpose',...contextEvidenceFields,'checkedAt'].filter(key=>r[key]!==undefined).map(key=>[key,r[key]])))
}
