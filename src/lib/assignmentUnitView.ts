/** @see ../../docs/modules/assignments/source-units.md */
import type {AssignmentUnit} from '../../day/assignment-units.mjs'
import type {DayWorkReview,ParentTaskGuide,DayMaterialLink} from './dayStore'
import type {EducationStatus} from '../../packages/education-presentation/notification.mjs'
/** An absent result is unknown, never evidence that the learner did nothing. */
export function assignmentUnitStatus(unit:AssignmentUnit,review:DayWorkReview|undefined,confirmed:boolean):{label:string;status:EducationStatus;explanation:string}{
 if(confirmed)return {label:unit.kind==='mixed'?'Есть проверенный результат':'Подтверждено проверкой',status:'complete',explanation:'Связанные с этим пунктом требования подтверждены проверкой. Школьная сдача учитывается отдельно.'}
 if(review?.status==='needs-fix')return {label:'Есть правка',status:'needs-fix',explanation:review.studentFeedback?.focus??'В разборе отмечено конкретное место для исправления.'}
 if(review?.status==='partial')return {label:'Часть подтверждена',status:'partial',explanation:review.items?.filter(item=>item.status!=='correct').map(item=>item.observed).filter(Boolean).join(' ')||'Часть требований подтверждена; оставшиеся пункты указаны в разборе.'}
 if(review)return {label:'Нужно уточнение',status:'unknown',explanation:review.items?.filter(item=>item.status==='cannot-assess').map(item=>[item.observed,item.note].filter(Boolean).join(' ')).join(' ')||review.assessmentBasis?.limitation||'Данных для вывода по этому пункту недостаточно. Это не означает, что задание не сделано.'}
 return {label:unit.kind==='reading'?'Чтение ещё не проверено':'Результат ещё не проверен',status:'unknown',explanation:'По этому пункту пока нет подтверждённого результата. Это не означает, что он не выполнен; источники и действия доступны внутри.'}
}
/** Scope a view only; this is never a new review, source or saved verdict. */
export function assignmentUnitReview(review:DayWorkReview|undefined,unit:AssignmentUnit):DayWorkReview|undefined{
 const ids=unit.guideStageIds??[]
 if(!review||!ids.length)return undefined
 const items=review.items?.filter(item=>item.stageId&&ids.includes(item.stageId))??[]
 if(!items.length)return undefined
 const status=items.every(item=>item.status==='correct')?'verified':items.some(item=>item.status==='incorrect')?'needs-fix':items.some(item=>item.status==='partial')?'partial':'cannot-assess'
 return {...review,items,checkableStageIds:review.checkableStageIds?.filter(id=>ids.includes(id)),status}
}
export function assignmentUnitGuide(guide:ParentTaskGuide|undefined,unit:AssignmentUnit):ParentTaskGuide|undefined{
 const stages=guide?.stages.filter(stage=>unit.guideStageIds?.includes(stage.id))??[]
 return guide&&stages.length?{...guide,stages,method:stages.length===guide.stages.length?guide.method:undefined,overview:unit.title}:undefined
}

/** Embedded published pages and lazy catalogue rows share one canonical identity. */
export function assignmentUnitSourceRef(link:DayMaterialLink):string{
 return link.catalogRef??link.sourceRef?.replace(/#pdf-0*([1-9]\d*)$/,'#$1')??''
}
