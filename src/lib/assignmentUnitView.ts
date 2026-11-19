/** @see ../../docs/modules/assignments/source-units.md */
import type {AssignmentUnit} from '../../day/assignment-units.mjs'
import type {DayWorkReview,ParentTaskGuide,DayMaterialLink} from './dayStore'
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
