/** @see ../docs/modules/reviews/review-criteria-provenance.md#context-evidence */
export type ContextEvidence={id:string;purpose:'context-evidence';type:'platform-result';title:string;points:number;maxPoints:number;/** Minutes observed on the screenshot. */duration:number;observedDate:string;uploadId:string;location:string;summary:string;checkedAt?:unknown}
export function contextEvidenceErrors(packet:unknown):string[]
export function contextEvidenceProjection(receipts:unknown):ContextEvidence[]
export function appendContextEvidence(previous:Record<string,unknown>|undefined,packet:unknown,now:unknown):Record<string,unknown>
