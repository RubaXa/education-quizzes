import {it,expect} from 'vitest'
import {assignmentUnitReview,assignmentUnitGuide,assignmentUnitSourceRef,assignmentUnitStatus} from './assignmentUnitView'
import type {AssignmentUnit} from '../../day/assignment-units.mjs'
import type {DayWorkReview,ParentTaskGuide} from './dayStore'
const unit={id:'ex1',guideStageIds:['assignment']} as AssignmentUnit
it('names unknown evidence without calling it unfinished and keeps partial distinct from ready',()=>{
 const unseen={id:'read',kind:'reading'} as AssignmentUnit
 expect(assignmentUnitStatus(unseen,undefined,false)).toMatchObject({status:'unknown',label:'Чтение ещё не проверено'})
 expect(assignmentUnitStatus(unit,{status:'partial'} as DayWorkReview,false)).toMatchObject({status:'partial',label:'Часть подтверждена'})
 const review={status:'cannot-assess',items:[{status:'cannot-assess',observed:'Последний пункт за краем кадра.',note:'Невыполнение не установлено.'}]} as DayWorkReview
 expect(assignmentUnitStatus(unit,review,false)).toMatchObject({status:'unknown',label:'Нужно уточнение',explanation:expect.stringContaining('Последний пункт за краем кадра.')})
 expect(assignmentUnitStatus(unit,review,true)).toMatchObject({status:'complete'})
 const projected={status:'cannot-assess',items:[{label:'Один',status:'cannot-assess'},{label:'Два',status:'cannot-assess'}]} as DayWorkReview
 expect(assignmentUnitStatus(unit,projected,false).explanation.trim().length).toBeGreaterThan(20)
})
it('scopes only addressed review evidence and keeps the other exercise unknown without copying a whole-task verdict',()=>{
 const review={id:'day:r',taskId:'mesh-1',status:'cannot-assess',checkedAt:{seconds:2},checkableStageIds:['assignment','evidence'],items:[{stageId:'assignment',label:'Запись1',status:'correct'},{stageId:'evidence',label:'Ответ2',status:'cannot-assess'}]} as DayWorkReview
 expect(assignmentUnitReview(review,unit)).toMatchObject({id:'day:r',taskId:'mesh-1',status:'verified',checkableStageIds:['assignment'],items:[{stageId:'assignment',status:'correct'}]})
 expect(assignmentUnitReview(review,{...unit,guideStageIds:['evidence']})?.status).toBe('cannot-assess')
 expect(assignmentUnitReview(review,{...unit,guideStageIds:[] })).toBeUndefined()
 expect(review.items).toHaveLength(2)
})
it('keeps only the selected closed guide stages, with the original stable identity and revision',()=>{
 const guide={revision:4,kind:'structured-notes',presentation:'learning-route',method:{name:'Общий метод',reason:'Два разных действия.',steps:['Один','Два']},overview:'Общий разбор',stages:[{id:'assignment',title:'Запись',answer:'PRIVATE_ONE'},{id:'evidence',title:'Ответ',answer:'PRIVATE_TWO'}]} as ParentTaskGuide
 expect(assignmentUnitGuide(guide,unit)).toMatchObject({revision:4,stages:[{id:'assignment',answer:'PRIVATE_ONE'}]})
 expect(assignmentUnitGuide(guide,unit)?.method).toBeUndefined()
 expect(guide.stages).toHaveLength(2)
})

it('matches canonical catalogue refs to embedded published PDF pages without reading the catalogue again',()=>{
 expect(assignmentUnitSourceRef({title:'Книга',sourceType:'textbook-page',url:'https://yadi.sk/example',sourceRef:'english#pdf-0044',pdfPage:44})).toBe('english#44')
 expect(assignmentUnitSourceRef({title:'Книга',sourceType:'textbook-page',url:'https://yadi.sk/example',sourceRef:'english#pdf-0044',catalogRef:'english#44'})).toBe('english#44')
 expect(assignmentUnitSourceRef({title:'Книга',sourceType:'textbook-page',url:'https://yadi.sk/example',sourceRef:'mesh-attachment:1'})).toBe('mesh-attachment:1')
})
