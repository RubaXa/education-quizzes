/** Shared family history projection; sources and closed fields are filtered before delivery.
 * @see ../../../docs/modules/assessments/olympiad-history.md */
export type HistoryFile={id:string;name:string;contentType:string;size:number;role:string;studentVisible:boolean}
export type HistoryTask={number:number;label?:string;score:number|null;maximum:number|null;statement:string|null;fileIds:string[];pages?:string}
export type HistoryStage={id:string;label:string;date:string|null;receivedOn?:string;score:number|null;maximum:number|null;state:string;award:string|null;rank:number|null;notes:string[];parentNotes?:string[];files:HistoryFile[];tasks:HistoryTask[]}
export type HistoryCompetition={id:string;title:string;aliases:string[];seasons:{id:string;label:string;grade:string|null;stages:HistoryStage[]}[]}
export type HistoryIndexEntry={id:string;title:string;aliases:string[];resultCount:number;seasonCount:number;summary:string}
