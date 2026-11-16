// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
import DecisionScenarioCatalog from './DecisionScenarioCatalog'
import {scenarioRules,scenarioData,decisionExamples} from './decisionScenarioFixtures'
import {decisionNodes} from '../../day/decision-registry.mjs'
vi.mock('@/lib/store',()=>({requestQuizFollowup:vi.fn(),setQuizRequired:vi.fn()}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML='';window.location.hash=''})
it('covers every declared subject/common rule with both real role compositions and exact graph identities',async()=>{
 document.body.append(host);root=createRoot(host)
 for(const rule of scenarioRules){
  expect(decisionExamples[rule.id],rule.id).toBeDefined()
  expect(decisionNodes.some(n=>n.id===rule.nodeId),rule.id).toBe(true)
  window.location.hash=`#/ui-kit/?decision=${rule.id}`
  await act(async()=>root!.render(<DecisionScenarioCatalog key={rule.id}/>))
  const frames=host.querySelectorAll('.edu-task-disclosure')
  expect(frames,rule.id).toHaveLength(2)
  for(const frame of frames){expect(frame.getAttribute('data-decision-nodes'),rule.id).toContain(rule.nodeId);expect(frame.getAttribute('data-decision-edges'),rule.id).toContain(rule.edgeIds[0]);expect(frame.hasAttribute('open')).toBe(false)}
  const student=host.querySelector('[aria-label="Карточка: Ученик"]')!
  expect(student.querySelector('.day-parent-guide'),rule.id).toBeNull()
  if(!scenarioData(rule.id).isQuiz)expect(student.textContent,rule.id).not.toContain(scenarioData(rule.id).guide.stages[1].expected)
  expect(host.querySelector('a[href*="criteria-knowledge-ui-kit-2026-11-16"]'),rule.id).not.toBeNull()
 }
})
it('changes state locally and keeps the embedded test header compact in its actual consumer frame',async()=>{
 window.location.hash='#/ui-kit/?decision=literature.reading';document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<DecisionScenarioCatalog/>))
 expect(host.querySelectorAll('.day-quiz-lineage-head.embedded')).toHaveLength(2)
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Зачтено')!.click())
 expect(host.querySelectorAll('.edu-task-summary-status')[0].textContent).toBe('Зачтено')
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Ученик')!.click())
 expect(host.querySelector('[aria-label="Карточка: Родитель"]')).toBeNull()
})
