/** @see ../docs/shared/design/student-review-step.md#assignment-clarification */
type FamilyTaskChoice={id:string;taskId:string;action:string;decidedAt:unknown}
export function taskRequirementChoice(taskId:string,events?:FamilyTaskChoice[]):boolean|undefined
export function taskRequired(task:{id:string;optional?:boolean},events?:FamilyTaskChoice[]):boolean
