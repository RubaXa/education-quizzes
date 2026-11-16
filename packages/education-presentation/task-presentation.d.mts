export type PresentationContract={id:string;title:string;components:string[];specRef:string;requiredFields:string[];checks:string[]}
export const presentationContracts:Record<string,PresentationContract>
export function presentationContractForRule(rule:{id?:string;product?:string}):PresentationContract
export type MaterialRequestPresentation={version:1;available:string[];missing:string[];reason:string;action:string;checkedAt:string;checkedSources:string[];coverage?:{collectionId:string;availablePages:number[];missingPages:number[]};continuation?:{label:string;dayToken:string;taskId:string}}
export function problemPresentationErrors(problem:unknown):string[]
export function guidePresentationErrors(guide:unknown):string[]
export function materialRequestPresentationErrors(request:unknown):string[]
