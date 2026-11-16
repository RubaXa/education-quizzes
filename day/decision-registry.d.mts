/** @see ../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
export type DecisionPresentation={presentationScope:'source'|'result'|'rule'|'context';presentationContractIds:string[];uiScenarioIds:string[];uiScenarioId?:string;technical:boolean;presentationNote?:string}
export type DecisionNode=DecisionPresentation&{id:string;label:string;actor:string;specRef:string;decisionRef:string;subject?:string;product?:string;checks?:string[]}
export type DecisionEdge=DecisionPresentation&{id:string;from:string;to:string;label:string;specRef:string;decisionRef:string}
export const decisionNodes:DecisionNode[]
export const decisionEdges:DecisionEdge[]
export function decisionPresentationBinding(itemId:string,scenarioId:string):{item:DecisionNode|DecisionEdge;uiScenarioId:string;contractIds:string[];technical:boolean;note?:string}|undefined
export function decisionCommonScope(kind:'node'|'edge',id:string):DecisionPresentation['presentationScope']
