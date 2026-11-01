import {describe,it,expect} from 'vitest'
import {previousLessonReference,planLessonRepetition as rawPlan} from './lesson-repetition.mjs'
import {quizDecision,validateAssessmentPlan} from './decision-graph.mjs'
import {taskRoute,eventTaskRoute} from '../sync/task-route.mjs'
const target={id:'repeat-new',familyId:'family',childId:'child',lessonDate:'2026-11-03',subject:'english',meshText:'задание прошлого урока',status:'verified',referenceDate:'2026-10-23'}
const parts=[{id:'written',kind:'written',topic:'Звуки',materialState:'ready',materialRef:'book-page-31',workEvidence:'prior-verified-6-of-6'},
{id:'oral',kind:'oral',topic:'Правило',materialState:'ready',materialRef:'book-page-33',workEvidence:'prior-12-of-13'}]
const lesson={id:'lesson-oct23',familyId:'family',childId:'child',subject:'Английский язык',date:'2026-10-23',verified:true,evidenceRef:'mesh-complete-snapshot',taskIds:['ex4','ex6'],parts}
const coverage={familyId:'family',childId:'child',subject:'english',from:'2026-11-02',through:'2026-11-02',checkedDates:['2026-11-02'],complete:true,evidenceRef:'verified-history-through-nov2',asOf:'2026-11-01'}
const planLessonRepetition=input=>rawPlan({...input,historyCoverage:{...coverage,subject:input.target.subject,from:'2026-10-21',checkedDates:Array.from({length:13},(_,i)=>new Date(Date.UTC(2026,9,21+i)).toISOString().slice(0,10))}})
describe('previous-lesson repetition',()=>{
 it('the authoring gate rejects dropping a repeated part or substituting its source',()=>{
  const spec={questions:[{id:'q1',kind:'short'},{id:'q2',kind:'short'}]}
  const plan={mode:'ordinary',sources:[{id:'written'},{id:'oral'}],items:[{questionId:'q1',sourceIds:['written']},{questionId:'q2',sourceIds:['oral']}],repetition:{targetTaskId:'repeat',previousLessonRef:'confirmed-lesson',parts:[{id:'a',sourceId:'written',questionIds:['q1']},{id:'b',sourceId:'oral',questionIds:['q2']}]}}
  const errors=p=>validateAssessmentPlan(p,spec).filter(e=>e.startsWith('Повторение:'))
  expect(errors(plan)).toEqual([])
  expect(errors({...plan,repetition:{...plan.repetition,parts:[plan.repetition.parts[0],{...plan.repetition.parts[1],questionIds:[]}]}})).toHaveLength(1)
  expect(errors({...plan,items:[plan.items[0],{questionId:'q2',sourceIds:['written']}]})).toHaveLength(1)
 })
 it('checks internal history before asking the child for a screenshot',()=>{
  expect(rawPlan({target,lessons:[lesson]})).toMatchObject({state:'history-not-verified',request:[],complete:false})
  expect(rawPlan({target,lessons:[lesson],historyCoverage:{...coverage,checkedDates:[]}}).state).toBe('history-not-verified')
 })
 it.each(['english','math','biology','history','russian','geography','literature','informatics'])('routes %s into a current check, regardless of a prior pass',subject=>{
  const plan=planLessonRepetition({target:{...target,subject},lessons:[{...lesson,subject}]})
  expect(plan).toMatchObject({state:'prepare-quiz',preservePriorWork:['written','oral'],request:[],complete:false})
  const task={...target,repetition:plan.repetition}
  expect(quizDecision(task)).toMatchObject({job:'prepare-quiz',mode:'ordinary'})
  expect(taskRoute(task,subject).next).toBe('prepare-quiz')
  expect(taskRoute({...task,testToken:'current-test'},subject).next).toBe('existing-assessment')
 })
 it('uses the last actual subject lesson across holidays and excludes other owners, future, cancelled and unverified lessons',()=>{
  const other=[{...lesson,id:'earlier',date:'2026-10-21'}, {...lesson,id:'foreign',date:'2026-11-02',childId:'other'},
   {...lesson,id:'other-family',date:'2026-11-02',familyId:'other'}, {...lesson,id:'cancelled',date:'2026-11-02',cancelled:true},
   {...lesson,id:'unverified',date:'2026-11-02',verified:false},{...lesson,id:'future',date:'2026-11-04'}]
  expect(planLessonRepetition({target,lessons:[...other,lesson]}).lessonId).toBe(lesson.id)
 })
 it('requests only a missing part, never a verified written solution',()=>{
  expect(planLessonRepetition({target,lessons:[{...lesson,parts:[parts[0],{...parts[1],materialState:'missing'}]}]})).toMatchObject({state:'missing-material',request:['oral']})
 })
 it('does not turn a screenshot of an assignment into content, evidence of repetition, or a resolved ambiguity',()=>{
  expect(planLessonRepetition({target,lessons:[]})).toMatchObject({state:'missing-previous-lesson',complete:false})
  expect(planLessonRepetition({target,lessons:[{...lesson,parts:[]}]}).state).toBe('missing-lesson-content')
  expect(planLessonRepetition({target,lessons:[lesson,{...lesson,id:'another-lesson'}]}).state).toBe('ambiguous-previous-lesson')
  expect(quizDecision(target)).toMatchObject({job:'classify-assignment',reason:'resolve-previous-lesson-before-requesting-upload'})
 })
 it('reuses only an assessment bound to the new assignment and date, not an old passing test',()=>{
  const currentAssessment={familyId:'family',childId:'child',taskId:target.id,lessonDate:target.lessonDate,token:'current'}
  expect(planLessonRepetition({target,lessons:[lesson],currentAssessment}).state).toBe('existing-assessment')
  expect(planLessonRepetition({target,lessons:[lesson],currentAssessment:{...currentAssessment,lessonDate:lesson.date}}).state).toBe('prepare-quiz')
 })
 it('replans a source upload through current assessment publication and both-role readback',()=>{
  const route=eventTaskRoute('upload.confirmed',{source:{purpose:'source-material'},context:{task:target,subject:'english'}})
  expect(route.steps).toContain('prepare-current-repetition-quiz')
  expect(route.steps).toContain('both-role-readback')
  expect(previousLessonReference({meshText:'См. ДЗ к 15 октября'})).toBe(false)
 })
})
