// @vitest-environment jsdom
/** @see ../../docs/modules/reviews/method-guided-solutions.md */
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it} from 'vitest'
import ParentTaskGuide from './ParentTaskGuide'
import {solutionGuideExample} from '@/lib/solutionExamples'
it('keeps the pill short and reveals one structured case with native mathematics',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
 const host=document.createElement('div'),root=createRoot(host)
 try{
  await act(async()=>root.render(<ParentTaskGuide guide={{...solutionGuideExample,overview:'Разбор для родителя · задача № 3'}}/>))
  expect(host.querySelector('.day-learning-route-heading')?.textContent).toBe('Ход решения')
  expect(host.textContent).not.toContain('задача № 3')
  expect(host.querySelector('math')?.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')
  expect(host.querySelector('math')?.textContent).toBe('1+2+3=6')
  const buttons=host.querySelectorAll<HTMLButtonElement>('.edu-solution-case-choices button')
  await act(async()=>buttons[1].click())
  expect(host.querySelector('math')?.textContent).toBe('1+2+4=7')
  expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('.edu-solution-conclusion')?.textContent).toBe('Не подходит')
 }finally{await act(async()=>root.unmount())}
})
