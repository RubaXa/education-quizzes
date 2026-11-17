import {readFileSync,existsSync} from 'node:fs'
import {expect,it} from 'vitest'
import {decisionNodes,decisionEdges,decisionPresentationBinding,decisionCommonScope} from './decision-registry.mjs'
import {presentationContracts,presentationContractForRule} from '../packages/education-presentation/task-presentation.mjs'
import {subjectDecisionProfiles,subjectDecisionPlan} from '../sync/subject-decisions.mjs'
it('links every node and transition to a real contract and decision, with no dangling endpoints',()=>{
 const ids=new Set(decisionNodes.map(n=>n.id));expect(ids.size).toBe(decisionNodes.length)
 for(const item of [...decisionNodes,...decisionEdges]){
  const [file,anchor]=item.specRef.split('#');expect(existsSync(file),item.id).toBe(true)
  if(anchor)expect(readFileSync(file,'utf8')).toContain(`{#${anchor}}`)
  expect(existsSync(item.decisionRef),item.id).toBe(true)
 }
 for(const e of decisionEdges){expect(ids.has(e.from),e.id).toBe(true);expect(ids.has(e.to),e.id).toBe(true)}
})
it('includes actual organizational, informational, platform, control and source-classification routes',()=>{
 const inputs=[{meshText:'нет'},{meshText:'Взять тетрадь и сдать в среду'},{kind:'cdz',meshText:'ЦДЗ'},{meshText:'Подготовиться к контрольной'},{meshText:'Из файла',materialStatus:{state:'teacher-attachment-linked'}}]
 for(const task of inputs)for(const action of subjectDecisionPlan(task,'russian').actions){
  expect(decisionNodes.some(n=>n.id===action.nodeId),action.ruleId).toBe(true)
  expect(action.edgeIds.every(id=>decisionEdges.some(e=>e.id===id)),action.ruleId).toBe(true)
  expect(action.uiScenarioId).toBe(action.ruleId)
 }
})

it('binds every graph element to executable UI scenarios and declared presentation contracts',()=>{
 const rules=Object.values(subjectDecisionProfiles).flatMap(profile=>profile.rules)
 for(const item of [...decisionNodes,...decisionEdges]){
  expect(item.presentationContractIds.length,item.id).toBeGreaterThan(0)
  expect(item.uiScenarioIds.length,item.id).toBeGreaterThan(0)
  for(const id of item.presentationContractIds)expect(presentationContracts[id],item.id).toBeDefined()
  for(const id of item.uiScenarioIds){
   expect(rules.some(rule=>rule.id===id),item.id).toBe(true)
   const binding=decisionPresentationBinding(item.id,id)
   expect(binding?.uiScenarioId,item.id).toBe(id)
   expect(binding?.contractIds.every(contract=>item.presentationContractIds.includes(contract)),item.id).toBe(true)
  }
  if(item.technical)expect(item.presentationNote,item.id).toContain('Отдельной семейной карточки нет')
 }
 for(const rule of rules)for(const id of [rule.nodeId,...rule.edgeIds])expect(decisionPresentationBinding(id,rule.id)?.contractIds).toEqual([presentationContractForRule(rule).id])
 expect(decisionPresentationBinding('subject:math.problem','english.production')).toBeUndefined()
 expect(decisionPresentationBinding('missing','math.problem')).toBeUndefined()
})

it('requires explicit layout decisions for new common graph nodes and transitions',()=>{
 for(const node of decisionNodes.filter(node=>!node.subject))expect(decisionCommonScope('node',node.id)).toBe(node.presentationScope)
 for(const edge of decisionEdges.filter(edge=>!edge.uiScenarioId))expect(decisionCommonScope('edge',edge.id)).toBe(edge.presentationScope)
 expect(()=>decisionCommonScope('node','source.new-source')).toThrow('Нет утверждённого макета')
 expect(()=>decisionCommonScope('node','new-stage')).toThrow('Нет утверждённого макета')
 expect(()=>decisionCommonScope('edge','source.mesh:new-stage')).toThrow('Нет утверждённого макета')
})

it('binds child clarification and parent choice to their actual common controls',()=>{
 for(const id of ['learner.context','family.requirement','context:clarification','clarification:family','family:component']){
  const item=[...decisionNodes,...decisionEdges].find(n=>n.id===id)
  expect(item.presentationContractIds).toEqual(['assignment-clarification'])
  expect(item.decisionRef).toBe('docs/decisions/adaptive-review-modes-2026-11-17.md')
 }
})

it('splits the role into a complete parent product and a safe learner product with concrete UI Kit bindings',()=>{
 for(const [id,contract] of [['view.parent-review','parent-review'],['view.student-support','review-result']]){
  const binding=decisionPresentationBinding(id,'literature.reading');expect(binding.contractIds).toEqual([contract]);expect(binding.item.uiScenarioId).toBe('literature.reading')
 }
 expect(decisionEdges.some(e=>e.from==='view.role'&&e.to==='view.component')).toBe(false)
 for(const id of ['role:parent','role:student','parent:component','student:component'])expect(decisionPresentationBinding(id,'literature.reading')).toBeDefined()
})
