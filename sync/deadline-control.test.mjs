import { expect, it } from 'vitest'
import { deadlineDecision, periodRiskChecks } from './deadline-control.mjs'
const task = { id: 'mesh-1', kind: 'written', problems: [{ id: 'a' }, { id: 'b' }] }
it('uses the same source-gap boundary before a deadline and restores it when the figure arrives',()=>{
 const sheet={...task,problems:[{id:'a'},{id:'b',original:{attachmentRef:'teacher#1'},sourceGap:{kind:'missing-figure',sourceRef:'teacher#1',reason:'No figure on the complete PDF page.'}}]}
 const input={task:sheet,today:'2026-11-16',dueDate:'2026-11-17',reviews:[{taskId:'a',status:'verified'}]}
 expect(deadlineDecision(input)).toMatchObject({work:'verified',missingIds:[],issues:['confirm-packing-with-child']})
 expect(deadlineDecision({...input,task:{...sheet,problems:sheet.problems.map(p=>({...p,sourceGap:undefined}))}})).toMatchObject({missingIds:['b'],issues:['audit-homework-and-archive']})
})
it('preserves both verified numbers but still checks packing on the preceding day', () => {
 const d = deadlineDecision({ task, today: '2026-11-16', dueDate: '2026-11-17', reviews: ['a','b'].map(taskId => ({taskId,status:'verified'})) })
 expect(d).toMatchObject({ stage: 'before', work: 'verified', missingIds: [], issues: ['confirm-packing-with-child'] })
})
it('reviews pending photos first; never treats missing evidence as missing work', () => {
 expect(deadlineDecision({task,today:'2026-11-16',dueDate:'2026-11-17',pendingUploadIds:['photo']}).issues).toEqual(['review-existing-uploads'])
 expect(deadlineDecision({task,today:'2026-11-16',dueDate:'2026-11-17'}).issues).toEqual(['audit-homework-and-archive'])
})
it('starts control readiness three days before; skips ordinary work then and optional practice', () => {
 expect(deadlineDecision({task,today:'2026-11-16',dueDate:'2026-11-19'})).toBeNull()
 expect(deadlineDecision({task:{...task,meshText:'Подготовиться к контрольной'},today:'2026-11-16',dueDate:'2026-11-19'}).issues).toContain('verify-independent-readiness')
 expect(deadlineDecision({task:{...task,optional:true},today:'2026-11-16',dueDate:'2026-11-17'})).toBeNull()
 expect(deadlineDecision({task,today:'2026-11-16',dueDate:'unknown'})).toBeNull()
})
it('does not classify independently completing an exercise as a control', () => {
 expect(deadlineDecision({task:{...task,meshText:'Самостоятельно выполнить упражнение 3'},today:'2026-11-16',dueDate:'2026-11-19'})).toBeNull()
})
it('requires published preparation three days before even without the exact teacher variant',()=>{
 const control={id:'control',kind:'check',meshText:'Самостоятельная работа по комбинаторике'}
 const d=deadlineDecision({task:control,today:'2026-11-16',dueDate:'2026-11-19'})
 expect(d.issues).toContain('publish-control-preparation')
 expect(d.preparation).toEqual({available:false,sourceRoute:'course-and-comparable-work',researchRequired:true})
 expect(deadlineDecision({task:control,today:'2026-11-16',dueDate:'2026-11-19',preparationAvailable:true,teacherMaterialAvailable:true}).issues).not.toContain('publish-control-preparation')
})
it('uses actual period dates, flags deterioration and keeps points outside the average', () => {
 const checks=periodRiskChecks([{subject_id:7,subject_name:'Math',average:'4.60',end:'2026-11-22',marks:[{date:'2026-11-10',value:5},{date:'2026-11-11',value:4},{date:'2026-11-13',value:3}],recentMarks:[{id:8,value:2,is_point:true}]}],'2026-11-16')
 expect(checks[0]).toMatchObject({ average:4.6,periodEnd:'2026-11-22',reasons:['latest-below-five','recent-deterioration','open-low-point'] })
 expect(periodRiskChecks([{subject_id:7,average:'5',end:'2026-12-30',marks:[]}],'2026-11-16')).toEqual([])
 expect(periodRiskChecks([{subject_id:7,average:'5',marks:[]}],'2026-11-16')[0].reasons).toEqual(['period-end-unknown'])
})

it('honours the persisted family choice in the existing deadline pass without changing teacher requirements',()=>{
 const task={id:'t',kind:'written',meshText:'Выполнить упражнение'},before=JSON.stringify(task)
 const optional={id:'choice',taskId:'t',action:'task-optional',decidedAt:{seconds:100,nanoseconds:0}}
 expect(deadlineDecision({task,today:'2026-11-16',dueDate:'2026-11-17',parentDecisions:[optional]})).toBeNull()
 expect(deadlineDecision({task:{...task,optional:true},today:'2026-11-16',dueDate:'2026-11-17',parentDecisions:[{...optional,action:'task-required'}]})).not.toBeNull()
 expect(JSON.stringify(task)).toBe(before)
})
