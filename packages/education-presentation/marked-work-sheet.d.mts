/** @see ../../docs/modules/reviews/marked-work-sheet.md#данные-и-приватность */
export type WorkSheetMark={id:string;status:'correct'|'incorrect'|'partial'|'unreadable'|'corrected';comment:string}
export type MarkedWorkSheet={version:1;title:string;blocks:{id:string;uploadId:string;location:string;parts:{text:string;mark?:WorkSheetMark}[]}[]}
export function markedWorkSheetValid(sheet:unknown):sheet is MarkedWorkSheet
