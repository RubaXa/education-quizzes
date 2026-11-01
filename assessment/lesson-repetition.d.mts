/** @see ../docs/decisions/lesson-repetition-2026-11-01.md */
/** @see ../docs/modules/assessments/lesson-repetition.md */
export function previousLessonReference(task?:{meshText?:string}):boolean
export function repetitionErrors(value:unknown):string[]
export function repetitionDecision(task:Record<string,unknown>):{job:string;reason:string;mode?:string;evidenceRef?:string}|null
export function planLessonRepetition(input:unknown):Record<string,unknown>
