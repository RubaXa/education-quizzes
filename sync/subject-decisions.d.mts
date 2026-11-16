export type SubjectRule={id:string;when:string;product:string;checks:string[];executor:string;nodeId:string;edgeIds:string[];uiScenarioId:string;specRef:string;decisionRef:string}
export const subjectDecisionProfiles:Record<string,{title:string;rules:SubjectRule[]}>
export function subjectDecisionPlan(task?:unknown,subject?:string,context?:unknown):{actions:Array<{ruleId:string;nodeId?:string;edgeIds?:string[]}>}
