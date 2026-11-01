// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,it,expect} from 'vitest'
import QuestionCard from './QuizQuestionCard'
import {ReadingCard,ThemeHero} from './SubjectTheme'
import QuizRunnerExample from '@/ui-kit/QuizRunnerExample'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
describe('one quiz runner in the app and UI Kit',()=>{
 it('normalizes authored description spacing without changing the exact prompt, reading or program',()=>{
  expect(renderToStaticMarkup(createElement(ThemeHero,{subject:'Английский язык',title:'Пример',description:'Повторение к3ноября. `x=2` https://example.com/a1'}))).toContain('к 3 ноября. `x=2` https://example.com/a1')
  const prompt='Сравни Н2О и А1:что записано?',code='x = 1\nif x > 0:\n    print(x)'
  const html=renderToStaticMarkup(createElement(QuestionCard,{question:{id:'q',kind:'number',prompt,points:1,code},index:0,subject:'Информатика',onAnswer:()=>{}}))
  expect(html).toContain(prompt);expect(html).toContain('    print(x)')
  const source=renderToStaticMarkup(createElement(ReadingCard,{reading:{heading:'Оригинал',paragraphs:['Н2О;с3страницы']}}))
  expect(source).toContain('Н2О;с3страницы')
 })
 it('keeps single/multiple input behavior, code and read-only mode in the real component',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  try{
   await act(async()=>root.render(createElement(QuizRunnerExample)))
   await act(async()=>host.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
   expect(host.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1)
   const choose=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!.click()
   await act(async()=>choose('Несколько вариантов'))
   await act(async()=>host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[0].click())
   await act(async()=>host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1].click())
   expect(host.querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(2)
   await act(async()=>choose('Только чтение'))
   expect([...host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].every(b=>b.disabled)).toBe(true)
   await act(async()=>choose('Код Python'))
   expect(host.querySelector('.code-frame')?.textContent).toContain('print(s)')
  }finally{await act(async()=>root.unmount());host.remove()}
 })
})
