import { expect, it } from 'vitest'
import { projectPreparation } from './preparation.mjs'
const stamp=n=>({seconds:n,nanoseconds:0})
const baseline={updatedOn:'2026-10-31',strengths:[{text:'Архивное достижение',evidenceIds:[]}],workingOn:[],next:null,evidence:[]}
const route={baseline,candidates:['a','b','c'].map(taskId=>({taskId,dayToken:'day',title:taskId,reason:'Разобрать задачу.',evidenceIds:[]})),goals:[{text:'Полнота доказательства',evidenceIds:[],taskIds:['a','b']}]}
const review=(status,at=10)=>({taskId:'a',status,checkedAt:stamp(at),studentFeedback:{confirmed:'Верный первый шаг.',focus:'Обосновать все случаи.'}})
it('preserves archive, advances past credited tasks and refines the gap from safe feedback',()=>{
 const p=projectPreparation(route,{a:{available:true,review:review('verified')},b:{available:true,review:review('partial')},c:{available:true}},null)
 expect(p.next.taskId).toBe('b');expect(p.next.reason).toBe('Обосновать все случаи.');expect(p.strengths).toEqual(baseline.strengths);expect(p.workingOn).toHaveLength(1)
 expect(p.progress.tasks[0].credited).toBe('review')
 expect(p.workingOn[0].text).toBe('Обосновать все случаи.')
})
it('retains dated achievement after a later correction, closes only the matching gap and ends an exhausted route',()=>{
 const first=projectPreparation(route,{a:{available:true,review:review('verified')}},null)
 const later=projectPreparation(route,{a:{available:true,review:review('partial',20)},b:{available:true,review:review('verified')},c:{available:true,review:review('verified')}},first)
 expect(later.next.taskId).toBe('a');expect(later.progress.tasks[0].achievedOn).toBe(first.progress.tasks[0].achievedOn);expect(later.progress.tasks[0].credited).toBeNull()
 const all=projectPreparation(route,Object.fromEntries(['a','b','c'].map(id=>[id,{available:true,review:{...review('verified'),taskId:id}}])),later)
 expect(all.next).toBeNull();expect(all.workingOn).toEqual([])
})
it('respects exact-version family acceptance and reopen, without presenting it as reviewed mastery',()=>{
 const r={...review('partial'),mathReasoning:{answer:'correct',argument:'incomplete'},assessmentBasis:{outcome:'not-met'}}
 const accept={id:'one',taskId:'a',action:'accept',reviewCheckedAt:stamp(10),decidedAt:stamp(11)}
 const state={a:{available:true,review:r,decisions:[accept]},b:{available:true}}
 expect(projectPreparation(route,state,null).next.taskId).toBe('b')
 expect(projectPreparation(route,state,null).progress.tasks[0].credited).toBe('family')
 state.a.decisions.push({...accept,id:'two',action:'reopen',decidedAt:stamp(12)})
 expect(projectPreparation(route,state,null).next.taskId).toBe('a')
 state.a.decisions=[accept];state.a.review={...r,checkedAt:stamp(20)}
 expect(projectPreparation(route,state,null).next.taskId).toBe('a')
})
it('does not invent gaps or achievements from missing evidence, source receipt, unavailable tasks or private fields',()=>{
 const p=projectPreparation(route,{a:{available:true,review:{...review('cannot-assess'),officialAnswer:'secret'}},b:{available:false,review:review('verified')},c:{available:true,review:{...review('verified'),purpose:'source-material'}}},null)
 expect(p.next.taskId).toBe('a');expect(p.next.reason).toContain('недостающий материал');expect(p.progress.tasks).toHaveLength(1);expect(p.progress.tasks[0]).toMatchObject({status:'cannot-assess',credited:null,confirmed:null,focus:null,achievedOn:null});expect(JSON.stringify(p)).not.toContain('secret')
})
it('excludes a task whose required stages are complete under the current family plan',()=>{
 const r={...review('partial'),checkableStageIds:['answer','proof'],items:[{stageId:'answer',status:'correct'},{stageId:'proof',status:'missing'}]}
 const state={a:{available:true,review:r,decisions:[{id:'one',taskId:'a',stageId:'proof',action:'stage-optional',reviewCheckedAt:stamp(10),decidedAt:stamp(11)}]},b:{available:true}}
 expect(projectPreparation(route,state,null).next.taskId).toBe('b')
 state.a.decisions[0].action='stage-required'
 expect(projectPreparation(route,state,null).next.taskId).toBe('a')
})
it('retains the first achievement when a new unreadable work cannot be assessed, without inventing a math gap',()=>{
 const first=projectPreparation(route,{a:{available:true,review:review('verified')}},null)
 const next=projectPreparation(route,{a:{available:true,review:{...review('cannot-assess',20),checkableStageIds:['a'],items:[{stageId:'a',status:'correct'}]}},b:{available:true}},first)
 expect(next.progress.tasks[0]).toMatchObject({status:'cannot-assess',credited:null,confirmed:null,focus:null,achievedOn:first.progress.tasks[0].achievedOn})
 expect(next.next.taskId).toBe('a');expect(next.next.reason).toContain('недостающий материал')
 expect(next.strengths).toEqual(first.strengths)
})
