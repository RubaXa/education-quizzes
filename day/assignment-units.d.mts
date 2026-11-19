/** @see ../docs/modules/assignments/source-units.md */
export type AssignmentUnit={id:string;title:string;kind:'written'|'reading'|'oral'|'mixed';sourceRefs:string[];original:string;instructions:string[];guideStageIds?:string[];learnerStageIds?:string[];quizToken?:string}
export type AssignmentUnitPlan={version:1;sourceText:string;items:AssignmentUnit[]}
export function assignmentUnitErrors(task:any,context?:{sourceRefs?:string[];guide?:any;subjectId?:string;placements?:any[]}):string[]
export function assignmentUnitNodes(task:any):{id:string;adapter:string}[]
export function assignmentOwnsQuiz(task:any,token:string):boolean
export function assignmentUnitShapeErrors(task:any,context?:{sourceRefs?:string[];subjectId?:string;placements?:any[]}):string[]
