/** Shared family history projection; sources and closed fields are filtered before delivery.
 * @see ../../../docs/modules/assessments/olympiad-history.md */
export type HistoryFile={id:string;name:string;contentType:string;size:number;role:string;studentVisible:boolean}
export type HistoryTask={number:number;label?:string;score:number|null;maximum:number|null;statement:string|null;fileIds:string[];pages?:string}
export type HistoryStage={id:string;label:string;date:string|null;receivedOn?:string;score:number|null;maximum:number|null;state:string;award:string|null;rank:number|null;notes:string[];parentNotes?:string[];files:HistoryFile[];tasks:HistoryTask[]}
export type PreparationEvidence={id:string;label:string;competitionId:string;seasonId:string;stageId:string;taskNumber?:number;file:HistoryFile}
export type PreparationPoint={text:string;evidenceIds:string[]}
export type PreparationProgress={exhausted:boolean;tasks:{taskId:string;title:string;status:'verified'|'partial'|'needs-fix';reviewVersion:string;checkedOn:string;credited:'review'|'family'|null;confirmed:string|null;focus:string|null;achievedOn:string|null}[]}
export type PersonalPreparation={updatedOn:string;strengths:PreparationPoint[];workingOn:PreparationPoint[];next:({taskId:string;title:string;reason:string;evidenceIds:string[]})|null;evidence:PreparationEvidence[];progress?:PreparationProgress}
export type HistoryCompetition={id:string;title:string;aliases:string[];preparation?:PersonalPreparation;seasons:{id:string;label:string;grade:string|null;stages:HistoryStage[]}[]}
export type HistoryIndexEntry={id:string;title:string;aliases:string[];resultCount:number;seasonCount:number;summary:string}
