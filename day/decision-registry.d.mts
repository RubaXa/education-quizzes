export type DecisionNode={id:string;label:string;actor:string;specRef:string;decisionRef:string;subject?:string;product?:string;checks?:string[];uiScenarioId?:string}
export type DecisionEdge={id:string;from:string;to:string;label:string;specRef:string;decisionRef:string}
export const decisionNodes:DecisionNode[]
export const decisionEdges:DecisionEdge[]
