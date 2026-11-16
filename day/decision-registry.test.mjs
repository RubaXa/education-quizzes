import {readFileSync,existsSync} from 'node:fs'
import {expect,it} from 'vitest'
import {decisionNodes,decisionEdges} from './decision-registry.mjs'
import {subjectDecisionPlan} from '../sync/subject-decisions.mjs'
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
