/** @see ../../docs/shared/design/compact-review.md#data */
export type ReviewVisualData =
 | { kind:'facts';label:string;items:{label:string;value:string}[] }
 | { kind:'annotation';label:string;parts:{text:string;mark?:'focus'|'reference'}[] }
 | { kind:'timeline';label:string;events:{date:string;label:string}[] }
 | { kind:'comparison';label:string;columns:string[];rows:string[][] }
export interface ReviewBriefDetail { label:string;text:string;quotation?:string;visual?:ReviewVisualData }
export interface ReviewSupplement { version:1;visual?:ReviewVisualData;details?:ReviewBriefDetail[] }
export function reviewVisualValid(value:unknown):boolean
export function reviewSupplementErrors(value:unknown):string[]
export function projectReviewSupplement(value:unknown):ReviewSupplement|undefined
