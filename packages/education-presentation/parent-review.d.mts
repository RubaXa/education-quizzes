/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
import type {SolutionBlock,SolutionMethod} from './solution-blocks.mjs'
import type {QuestionResult} from '../../src/lib/quiz'
export type ParentReviewAnalysis={version:1;answer:string;difference:string;method:SolutionMethod;blocks:SolutionBlock[];source:{label:string;location:string}}
export type ParentReviewState={state:'loading'|'error'|'stale'}|{state:'ready';analysis:ParentReviewAnalysis}
export function parentReviewErrors(value:unknown):string[]
export function parentReviewContext(result:QuestionResult,submittedAt:unknown):Record<string,unknown>
export function parentReviewMatches(record:unknown,result:QuestionResult,submittedAt:unknown,quizToken?:string):boolean
