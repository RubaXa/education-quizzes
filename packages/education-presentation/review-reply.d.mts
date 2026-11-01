import type {ReviewActivityData} from './review-activity.mjs'
import type {ReviewSupplement} from './review-content.mjs'
export type ReviewValue={selected:string[];groups:Record<string,string>;written:Record<string,string>}
export type ReviewReply={version:1;sourceId:string;checkedAt:unknown;correctedAt:unknown;step:{question:string;activity:ReviewActivityData};intent:'answer'|'stuck';value:string}
export type ReviewResponse={outcome:'correct'|'partial'|'retry'|'stuck'|'clarify';message:string;complete?:true;next?:{title:string;confirmed?:string;focus?:string;bridge?:string;question:string;presentation:ReviewSupplement}}
export function reviewReplyErrors(value:unknown):string[]
export function reviewResponseErrors(value:unknown):string[]
export function reviewValueValid(activity:ReviewActivityData,value:unknown,options?:{allowEmpty?:boolean}):boolean
export function reviewCanonical(value:unknown):unknown
export function sameReviewValue(a:unknown,b:unknown):boolean
export function resolveReviewReplyStep(reply:ReviewReply,review:unknown,guidance?:unknown):ReviewReply['step']
