/** @see ../../docs/shared/design/compact-review.md#data */
export type ReviewVisualData =
 | { kind:'facts';label:string;items:{label:string;value:string}[] }
 | { kind:'annotation';label:string;parts:{text:string;mark?:'focus'|'reference'}[] }
 | { kind:'timeline';label:string;events:{date:string;label:string}[] }
 | { kind:'comparison';label:string;columns:string[];rows:{cells:string[]}[] }
export interface ReviewBriefDetail { label:string;text:string;quotation?:string;visual?:ReviewVisualData }
export interface ReviewSupplement { version:1;visual?:ReviewVisualData;details?:ReviewBriefDetail[];activity?:import('./review-activity.mjs').ReviewActivityData }
export const reviewOverviewLimits:Readonly<{title:number;confirmed:number;focus:number;bridge:number;question:number;total:number}>
export function reviewOverviewErrors(feedback:unknown):string[]
export function reviewVisualValid(value:unknown):boolean
export function reviewSupplementErrors(value:unknown):string[]
export function projectReviewSupplement(value:unknown):ReviewSupplement|undefined
