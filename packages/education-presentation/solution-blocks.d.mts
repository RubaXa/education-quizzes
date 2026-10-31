/** @see ../../docs/modules/reviews/method-guided-solutions.md */
import type {ReviewVisualData} from './review-content.mjs'
export type MathExpression={kind:'number'|'symbol'|'operator'|'text';value:string}|{kind:'row';items:MathExpression[]}|{kind:'fraction';numerator:MathExpression;denominator:MathExpression}|{kind:'power';base:MathExpression;exponent:MathExpression}
export type SolutionBlock={kind:'text';title?:string;text:string}|{kind:'formula';label:string;expression:MathExpression}|{kind:'visual';visual:ReviewVisualData}|{kind:'source';label:string;url:string}|{kind:'grid';label:string;rows:number;columns:number;columnLabels?:string[];rowLabels?:string[];cells:{row:number;column:number;mark:'first'|'second'|'cut'|'focus';label?:string}[]}|{kind:'graph';label:string;nodes:{id:string;label:string;x:number;y:number}[];edges:{from:string;to:string}[]}|{kind:'flow';label:string;steps:string[]}|{kind:'cases';label:string;cases:{label:string;result:string;blocks:SolutionBlock[]}[]}
export type SolutionMethod={name:string;reason:string;steps:string[]}
export function validMathExpression(value:unknown):boolean
export function solutionBlocksErrors(value:unknown):string[]
export function projectSolutionBlocks(value:unknown):SolutionBlock[]|undefined
export function solutionMethodErrors(value:unknown):string[]
