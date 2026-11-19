// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
import DecisionScenarioCatalog from './DecisionScenarioCatalog'
import {scenarioRules,scenarioData,missingSourceScenario,decisionExamples} from './decisionScenarioFixtures'
import {decisionNodes,decisionEdges} from '../../day/decision-registry.mjs'
import {problemPresentationErrors,guidePresentationErrors} from '../../packages/education-presentation/task-presentation.mjs'
import {getDoc,getDocs,onSnapshot} from 'firebase/firestore'
vi.mock('firebase/firestore',async importOriginal=>({...await importOriginal<typeof import('firebase/firestore')>(),getDoc:vi.fn(()=>{throw Error('UI Kit must not read family documents')}),getDocs:vi.fn(()=>{throw Error('UI Kit must not read family collections')}),onSnapshot:vi.fn(()=>{throw Error('UI Kit must not subscribe to family data')})}))
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
},15000)
it('changes state locally and keeps the embedded test header compact in its actual consumer frame',async()=>{
 window.location.hash='#/ui-kit/?decision=literature.reading';document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<DecisionScenarioCatalog/>))
 expect(host.querySelectorAll('.day-quiz-lineage-head.embedded')).toHaveLength(2)
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Зачтено')!.click())
 expect(host.querySelectorAll('.edu-task-summary-status')[0].textContent).toBe('Зачтено')
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Ученик')!.click())
 expect(host.querySelector('[aria-label="Карточка: Родитель"]')).toBeNull()
})

it('renders numbered mathematics through the production statement and separate atomic facts',async()=>{
 window.location.hash='#/ui-kit/?decision=math.problem';document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<DecisionScenarioCatalog/>))
 expect(host.querySelectorAll('.problem-statement')).toHaveLength(2)
 expect(host.querySelectorAll('[aria-label="Дано"] strong').length).toBeGreaterThan(2)
 expect(host.querySelector('[aria-label="Карточка: Ученик"] .day-parent-guide')).toBeNull()
})

it('uses the production numbered composition, structured parent transitions and no closed key in either student variant',async()=>{
 document.body.append(host);root=createRoot(host)
 for(const ruleId of ['math.problem','special.sheet'])for(const variant of ['single','multipart'] as const){
  window.location.hash=`#/ui-kit/?decision=${ruleId}&example=${variant}`
  await act(async()=>root!.render(<DecisionScenarioCatalog key={`${ruleId}:${variant}`}/>))
  const data=scenarioData(ruleId,variant)
  expect(problemPresentationErrors(data.problem)).toEqual([])
  expect(guidePresentationErrors(data.guide)).toEqual([])
  const parent=host.querySelector('[aria-label="Карточка: Родитель"]')!
  const student=host.querySelector('[aria-label="Карточка: Ученик"]')!
  for(const role of [parent,student]){
   await act(async()=>role.querySelector<HTMLElement>('.edu-task-disclosure > summary')!.click())
   await act(async()=>role.querySelector<HTMLElement>('.problem-card > summary')!.click())
   expect(role.querySelector('.problem-statement')?.getAttribute('data-presentation-layout')).toBe(variant)
   expect(role.querySelector('.problem-statement-text')?.textContent).toContain(data.problem!.original!.text)
   expect(role.querySelectorAll('.problem-statement-part')).toHaveLength(variant==='multipart'?2:0)
  }
  await act(async()=>parent.querySelector<HTMLElement>('.day-parent-guide > summary')!.click())
  expect(parent.querySelector('.edu-method-overview')?.textContent).toContain(data.guide.method!.name)
  expect(parent.querySelectorAll('.day-learning-route-stage')).toHaveLength(4)
  for(const summary of parent.querySelectorAll<HTMLElement>('.day-learning-route-stage > summary'))await act(async()=>summary.click())
  expect(parent.querySelectorAll('math').length).toBeGreaterThan(0)
  expect(student.querySelector('.day-parent-guide')).toBeNull()
  expect(student.querySelector('math')).toBeNull()
  expect(student.textContent).not.toContain('Ответ:')
  if(variant==='multipart'){
   expect(data.problem!.support!.facts).toEqual([]);expect(data.problem!.support!.find).toBe('')
   expect([...student.querySelectorAll('.problem-statement-part h4')].map(el=>el.textContent)).toEqual(['1. Овощная база','2. Маршрут туристов'])
   expect(student.querySelectorAll('[aria-label="Дано"] strong')).toHaveLength(6)
   const choices=parent.querySelectorAll<HTMLElement>('.edu-solution-case-choices')
   for(const choice of choices)await act(async()=>[...choice.querySelectorAll('button')].find(button=>button.textContent==='2. Маршрут туристов')!.click())
   expect(parent.textContent).toContain('Ответ: 15 км до обеда')
   expect(student.textContent).not.toContain('15 км')
  }
 }
})
it('provides a working layout address for every visible graph node and edge, including technical steps',async()=>{
 window.location.hash='#/ui-kit/?decision=math.problem';document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<DecisionScenarioCatalog/>))
 const nodes=decisionNodes.filter(node=>!node.subject||node.id==='subject:math.problem')
 const edges=decisionEdges.filter(edge=>nodes.some(node=>node.id===edge.from)&&nodes.some(node=>node.id===edge.to))
 for(const [items,label] of [[nodes,'узла'],[edges,'перехода']] as const)for(const item of items){
  window.location.hash='#/ui-kit/?decision=math.problem'
  await act(async()=>root!.render(<DecisionScenarioCatalog key={item.id}/>))
  const anchor=host.querySelector<HTMLAnchorElement>(`a[aria-label="Макет ${label} ${item.id}"]`)!
  expect(anchor,item.id).not.toBeNull()
  const rolePilot=['view.parent-review','view.student-support','role:parent','role:student','parent:component','student:component'].includes(item.id)
  const query=new URLSearchParams(anchor.hash.split('?')[1]);expect(query.get('decision')).toBe(rolePilot?'literature.reading':'math.problem');expect(query.get('focus')).toBe(item.id)
  await act(async()=>anchor.click())
  expect(host.querySelector('[data-focused-graph-item]')?.getAttribute('data-focused-graph-item')).toBe(item.id)
  if(rolePilot){
   expect(host.querySelector('[aria-label="Пример: родитель"] .edu-parent-review')).not.toBeNull()
   expect(host.querySelector('[aria-label="Пример: ребёнок"] .edu-review-question')).not.toBeNull()
  }else expect(host.querySelectorAll('.edu-decision-role')).toHaveLength(2)
  expect(host.querySelector('[data-inspected-contract]')).not.toBeNull()
  if(item.technical)expect(host.querySelector('.edu-decision-layout-inspector')?.textContent).toContain('Отдельной семейной карточки нет')
 }
},15000)
it('keeps all synthetic role compositions free of family document reads and subscriptions',()=>{
 expect(getDoc).not.toHaveBeenCalled();expect(getDocs).not.toHaveBeenCalled();expect(onSnapshot).not.toHaveBeenCalled()
})

it('shows an actual missing-source composition in both roles without answers or duplicated technical prompts',async()=>{
 document.body.append(host);root=createRoot(host)
 for(const id of ['math.problem','history.reading']){
  window.location.hash=`#/ui-kit/?decision=${id}`
  await act(async()=>root!.render(<DecisionScenarioCatalog key={id}/>))
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Не хватает источника')!.click())
  expect(host.querySelector('[data-inspected-contract]')?.getAttribute('data-inspected-contract')).toBe('source-request')
  const {request}=missingSourceScenario(id)
  for(const role of host.querySelectorAll('.edu-decision-role')){
   await act(async()=>role.querySelector<HTMLElement>('.edu-task-disclosure > summary')!.click())
   expect(role.getAttribute('data-presentation-contract')).toBe('source-request')
   expect(role.querySelectorAll('.material-request')).toHaveLength(1)
   for(const text of [...request.presentation!.available,...request.presentation!.missing,request.presentation!.reason,request.presentation!.action])expect(role.textContent).toContain(text)
   expect(role.textContent).not.toContain(request.question);expect(role.textContent).not.toContain(request.photoPrompt)
   expect(role.querySelector('.day-parent-guide')).toBeNull();expect(role.querySelector('.problem-statement')).toBeNull();expect(role.querySelector('.day-quiz-lineage-head')).toBeNull()
   expect(role.textContent).not.toContain('Зачтено');expect(role.textContent).not.toContain('Ответ:')
  }
  expect(host.querySelector('[aria-label="Карточка: Ученик"] input[type="file"]')).not.toBeNull()
  if(id==='history.reading')expect(host.querySelector('[aria-label="Карточка: Ученик"]')?.textContent).not.toContain('причины и последствия')
 }
})
it('treats an available source-classification example as source context rather than a missing-page request or graded work',async()=>{
 window.location.hash='#/ui-kit/?decision=history.source-classification';document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<DecisionScenarioCatalog/>))
 for(const role of host.querySelectorAll('.edu-decision-role')){
  expect(role.getAttribute('data-presentation-contract')).toBe('source-context')
  expect(role.querySelector('.day-assignment-brief')).not.toBeNull()
  expect(role.querySelector('.source-fragment')).not.toBeNull()
  expect(role.querySelector('.material-request')).toBeNull();expect(role.querySelector('.day-parent-guide')).toBeNull()
 }
})

it('preserves missing-source in a copied layout address and avoids inventing source requests for informational notes',async()=>{
 window.location.hash='#/ui-kit/?decision=history.reading&focus=source.criteria&state=missing-source';document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<DecisionScenarioCatalog/>))
 expect(host.querySelectorAll('.material-request')).toHaveLength(2)
 const address=[...host.querySelectorAll('a')].find(anchor=>anchor.textContent==='Адрес этого сценария')!
 expect(new URLSearchParams(address.hash.split('?')[1]).get('state')).toBe('missing-source')
 window.location.hash='#/ui-kit/?decision=common.information'
 await act(async()=>root!.render(<DecisionScenarioCatalog key="information"/>))
 expect([...host.querySelectorAll('button')].some(button=>button.textContent==='Не хватает источника')).toBe(false)
 expect(host.querySelector('.material-request')).toBeNull()
})

it('binds the exercise node and both edges to real source-first units for English, Russian and literature',async()=>{
 document.body.append(host);root=createRoot(host)
 for(const decision of ['english.exercise','russian.exercise','literature.reading'])for(const focus of ['artifact.units','prepare:units','units:role']){
  window.location.hash=`#/ui-kit/?decision=${decision}&focus=${focus}`
  await act(async()=>root!.render(<DecisionScenarioCatalog key={`${decision}:${focus}`}/>))
  expect(host.querySelectorAll('.assignment-unit')).toHaveLength(4)
  expect(host.querySelectorAll('.assignment-unit[open]')).toHaveLength(0)
  for(const unit of host.querySelectorAll('.assignment-unit')){
   expect(unit.getAttribute('data-decision-nodes')).toContain('artifact.units')
   expect(unit.querySelector('.day-reader')!.compareDocumentPosition(unit.querySelector('.assignment-unit-instructions')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
  expect(host.querySelector('[aria-label="Карточка: Ученик"] .day-parent-guide')).toBeNull()
 }
})
