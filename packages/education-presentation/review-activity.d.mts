/** @see ../../docs/shared/design/student-review-step.md */
export type ReviewActivityData={
 kind:'mark'|'build'|'sort'|'write';label:string;instruction:string;tokens:{id:string;text:string}[]
 groups?:{id:string;label:string}[];joiner?:' '|' + '|' · '|' → '|'';repeat?:boolean;maxItems?:number;frame?:({text:string;slotId?:never}|{slotId:string;text?:never})[]
 diagram?:{kind:'lines';label:string;segments:{id:string;from:{x:number;y:number};to:{x:number;y:number};label?:string}[]}
 |{kind:'grid';label:string;rows:number;columns:number;cells:{row:number;column:number;mark:'hit'|'miss'|'given';tokenId?:string}[]}
 |{kind:'chain';label:string;nodes:string[]}
}
export function reviewActivityValid(value:unknown):boolean
export function projectReviewActivity(value:unknown):ReviewActivityData|undefined
