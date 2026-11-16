import { existsSync } from 'node:fs'
import { expect, it } from 'vitest'
import { eventTaskRoute, taskRoute } from './task-route.mjs'
import { subjectDecisionPlan, subjectDecisionProfiles } from './subject-decisions.mjs'
import { decisionEvidence } from './decision-evidence.mjs'

it('links mixed products separately and exposes missing learner knowledge without asserting completion', () => {
  const task={id:'mesh-1',kind:'written',meshText:'Упр.3 письменно, правило повторить',sourceRevision:7,instructionStatus:{state:'reviewed'}}
  const trace=taskRoute(task,'russian').decisionEvidence
  expect(trace.expectedProducts.map(x=>x.productKind)).toEqual(['source-linked-written-guide','source-covered-quiz'])
  expect(new Set(trace.decisions.map(x=>x.actionId)).size).toBe(2)
  expect(trace.unknown).toContainEqual({kind:'learner-context',reason:'goals-trajectory-and-misconceptions-not-supplied'})
  expect(trace.sourceRevision).toBe(7)
  expect(trace.completionClaim).toBe(false)
})
it('indexes the exact private packet without copying a guide or key into the route', () => {
  const route=eventTaskRoute('help.requested',{owner:{familyId:'f',childId:'c'},
    context:{subject:'Математика',task:{id:'mesh-2',kind:'written',meshText:'Решить задачу',sourceRevision:3},materialLinks:[{sourceRef:'teacher:1'}]},
    previousReview:{status:'partial',secret:'PRIVATE_ATTEMPT'},parentGuide:{answer:'PRIVATE_SOLUTION'},answerKey:{answer:'PRIVATE_KEY'},
    decisionContext:{parentRefs:['event:parent'],learnerFacts:[{ref:'event:attempt',scope:'skill:fractions',revision:2}]}})
  expect(route.decisionEvidence.owner).toEqual({familyId:'f',childId:'c'})
  expect(route.decisionEvidence.facts.map(x=>x.kind)).toEqual(expect.arrayContaining(['previousReview','parentGuide','answerKey','learner-evidence','parent-context']))
  expect(route.decisionEvidence.unknown).toEqual([])
  expect(JSON.stringify(route)).not.toMatch(/PRIVATE_(?:ATTEMPT|SOLUTION|KEY)/)
  expect(route.decisionEvidence.knowledgeUpdate.state).toBe('requires-observed-response')
})
it('distinguishes an exact microresponse from a parent worksheet and a new guide',()=>{
  const trace=eventTaskRoute('help.requested',{source:{taskId:'p1'},context:{subject:'Математика',task:{id:'sheet',kind:'written',meshText:'Решить задачи'}}}).decisionEvidence
  expect(trace).toMatchObject({taskId:'p1',parentTaskId:'sheet'})
  expect(trace.expectedProducts[0]).toMatchObject({productKind:'addressed-microresponse',completionScope:'microresponse-only'})
  expect(trace.subjectProducts[0].productKind).toBe('source-linked-written-guide')
})
it('indexes source intake and submitted quiz review as event products even without a day task',()=>{
  const source=eventTaskRoute('upload.confirmed',{source:{taskId:'p2',purpose:'source-material'},context:{task:{id:'sheet',kind:'written',meshText:'Упр.2'}}}).decisionEvidence
  expect(source.expectedProducts[0].productKind).toBe('source-analysis-and-dependent-replan')
  const quiz=eventTaskRoute('quiz.submitted',{sourcePath:'assignments/quiz-token',source:{status:'submitted'}}).decisionEvidence
  expect(quiz.taskId).toBe('quiz-token')
  expect(quiz.expectedProducts[0].productKind).toBe('addressed-quiz-review')
  expect(quiz.unknown).toContainEqual({kind:'assignment-context',reason:'containing-day-task-not-supplied'})
})
it('does not turn an unreferenced skill, a PDF link or a stamp into knowledge or a prepared product', () => {
  const plan=subjectDecisionPlan({id:'sheet',meshText:'Из файла',instructionStatus:{state:'reviewed'}},'special',{hasTeacherFiles:true})
  const trace=decisionEvidence(plan,{decisionContext:{learnerFacts:[{scope:'all-mathematics'}]}})
  expect(trace.unknown.some(x=>x.kind==='learner-context')).toBe(true)
  expect(trace.expectedProducts[0]).toMatchObject({productKind:'verified-material-purpose',state:'requires-verification'})
  expect(trace.completionClaim).toBe(false)
})
it('uses existing publishers and consumers for every declared subject product', () => {
  for (const profile of Object.values(subjectDecisionProfiles)) for (const rule of profile.rules) {
    const trace=decisionEvidence({actions:[{ruleId:rule.id,product:rule.product}]})
    for (const field of ['existingPublisher','existingConsumer']) expect(existsSync(trace.expectedProducts[0][field]),`${rule.id}:${field}`).toBe(true)
  }
})
