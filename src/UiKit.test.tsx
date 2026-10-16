/// <reference types="node" />
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import UiKit from './UiKit'
import { uiKitQuizExamples } from './lib/uiKitExamples'
import { summarize } from '@/lib/quiz'
vi.mock('@/lib/store',()=>({requestQuizFollowup:vi.fn(),setQuizRequired:vi.fn()}))
vi.mock('./education-design-tokens.css?raw',async()=>({default:(await import('node:fs')).readFileSync('src/education-design-tokens.css','utf8')}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML=''})
/** @see ../docs/product/ui-kit.md */
it('uses the real components, token source and local interactive controls',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 expect(host.querySelector('.edu-result-badge')?.textContent).toContain('87%')
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='84.99%')!.click())
 expect(host.querySelector('.edu-result-badge')?.getAttribute('data-tone')).toBe('attention')
 const select=host.querySelector('select')!;await act(async()=>{select.value='waiting';select.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.querySelector('[role="meter"]')).toBeNull()
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Цвета и токены')!.click())
 expect(host.textContent).toContain('--edu-status-success-ink');expect(host.textContent).toContain('var(--edu-success-ink)')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='История тестов')!.click())
 expect(host.querySelector('.day-quiz-lineage')).not.toBeNull()
 expect(host.textContent).toContain('условными данными')
 expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0)
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-quiz-history-select')!.click())
 expect(host.querySelectorAll('a[href*="/t/"]')).toHaveLength(0)
})
it('has internally consistent example points and counts',()=>{
 for(const test of uiKitQuizExamples){const score=summarize(test.results!);expect(score.earned).toBe(test.points);expect(score.possible).toBe(test.maxPoints)}
})

/** @see ../docs/product/dashboard.md#compact-homework */
it('previews the real homework component and its existing click targets',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Сводка ДЗ')!.click())
 expect(host.querySelector('[aria-label="Домашнее задание"] time')?.textContent).toBe('Понедельник, 19 октября')
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-dashboard-homework-row')!.click())
 expect(host.querySelector('[role="status"]')?.textContent).toContain('Английский язык')
 expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-homework-complete')?.open).toBe(false)
})

/** @see ../docs/product/material-clarification.md */
it('previews the source question using the shared local photo control',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Уточнение материала')!.click())
 expect(host.querySelector('[aria-label="Уточнение материала"]')).not.toBeNull()
 const input=host.querySelector<HTMLInputElement>('.day-upload input')!
 expect(input.accept).toBe('image/*');expect(input.multiple).toBe(true)
 Object.defineProperty(input,'files',{value:[new File(['demo'],'notes.jpg',{type:'image/jpeg'})],configurable:true})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})))
 expect(host.textContent).toContain('Выбрано файлов: 1')
 expect(host.textContent).not.toContain('Работа проверена')
})
