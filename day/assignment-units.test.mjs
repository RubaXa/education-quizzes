import {describe,it,expect} from 'vitest'
import {assignmentUnitErrors,assignmentUnitShapeErrors,assignmentUnitNodes,assignmentOwnsQuiz} from './assignment-units.mjs'
const token='synthetic-quiz-token-123456'
function fixture(){
 const task={id:'mesh-1',meshText:'Упражнения1 и2.',kind:'written',learnerFlow:{stages:[{id:'read'},{id:'write'}]},assignmentUnits:{version:1,sourceText:'Упражнения1 и2.',items:[
  {id:'exercise-1',title:'Упр.1',kind:'written',sourceRefs:['book#44'],original:'Write five phrases.',instructions:['Выпиши пять словосочетаний.'],guideStageIds:['assignment'],learnerStageIds:['write']},
  {id:'exercise-2',title:'Упр.2',kind:'oral',sourceRefs:['book#44','book#45'],original:'Read and answer.',instructions:['Прочитай текст и ответь.'],guideStageIds:['evidence'],learnerStageIds:['read'],quizToken:token}
 ]}}
 const context={sourceRefs:['book#44','book#45'],subjectId:'english',placements:[{subjectId:'english',token}],guide:{stages:[{id:'assignment'},{id:'evidence'}]}}
 return {task,context}
}
describe('source-bound assignment units',()=>{
 it('uses the exact teacher instruction as an original for notebook repetition, without inventing a textbook page',()=>{
  const task={id:'mesh-notes',meshText:'Учим записи в тетрадях.',assignmentUnits:{version:1,sourceText:'Учим записи в тетрадях.',items:[{id:'notes',title:'Повторить конспект',kind:'reading',sourceRefs:['mesh-notes'],original:'Учим записи в тетрадях.',instructions:['Повтори назначенные записи в своей тетради.']}]}}
  expect(assignmentUnitErrors(task)).toEqual([])
  task.assignmentUnits.items[0].original='Выучи параграф21.'
  expect(assignmentUnitErrors(task).length).toBeGreaterThan(0)
 })
 it('uses the same gate for public shape, native publication and addressed correction without changing teacher scope',()=>{
  const {task,context}=fixture();expect(assignmentUnitErrors(task,context)).toEqual([]);expect(assignmentUnitShapeErrors(task,context)).toEqual([])
  expect(assignmentOwnsQuiz(task,token)).toBe(true)
  expect(assignmentUnitNodes(task)).toEqual([{id:'exercise-1',adapter:'written'},{id:'exercise-2',adapter:'oral'}])
 })
 it.each(['source','duplicate','missing-unit','private-key','unknown-stage','lost-guide','foreign-quiz','new-mesh','second-split','extra-field'])('rejects %s before publication',kind=>{
  const {task,context}=fixture(),unit=task.assignmentUnits.items[1]
  if(kind==='source')unit.sourceRefs=['other-child#45']
  if(kind==='duplicate')unit.id='exercise-1'
  if(kind==='missing-unit')task.assignmentUnits.items.pop()
  if(kind==='private-key')unit.answer='PRIVATE_KEY'
  if(kind==='unknown-stage')unit.guideStageIds=['missing']
  if(kind==='lost-guide')unit.guideStageIds=[]
  if(kind==='foreign-quiz')context.placements[0].subjectId='math'
  if(kind==='new-mesh')task.meshText='Уже другое задание.'
  if(kind==='second-split')task.problems=[{id:'p1'}]
  if(kind==='extra-field')task.assignmentUnits.unverifiedAnswer='PRIVATE'
  expect(assignmentUnitErrors(task,context).length).toBeGreaterThan(0)
 })
 it('does not pretend that the public shape validates a closed guide',()=>{
  const {task,context}=fixture();delete context.guide
  expect(assignmentUnitShapeErrors(task,context)).toEqual([])
  expect(assignmentUnitErrors(task,context).length).toBeGreaterThan(0)
 })
 it('retains mathematics as the existing unit adapter and ordinary unstructured tasks as legacy',()=>{
  expect(assignmentUnitNodes({problems:[{id:'mesh-2-p1'}]})).toEqual([{id:'mesh-2-p1',adapter:'math-problem'}])
  expect(assignmentUnitErrors({id:'old'})).toEqual([])
  expect(assignmentUnitNodes({id:'old'})).toEqual([])
 })
})
