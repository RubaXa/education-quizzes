// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QuizCard from './QuizCard'
import { quizAnswerCounts, quizHistoryNewestFirst, type QuizCardAttempt } from '@/lib/quizCardViewModel'
import type { QuestionResult } from '@/lib/quiz'
vi.mock('@/lib/store',()=>({requestQuizFollowup:vi.fn().mockResolvedValue(undefined),setQuizRequired:vi.fn().mockResolvedValue(undefined)}))
import { requestQuizFollowup } from '@/lib/store'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const answers=(n:number,c:number):QuestionResult[]=>Array.from({length:n},(_,i)=>({question:{id:`q${i}`,kind:'short',points:1,prompt:`Вопрос ${i+1}`},answer:i<c?'Верно':'Мой ответ',correctAnswer:'Закрытый ключ',points:i<c?1:0}))
const attempt=(testId:string,points:number,maxPoints:number,n:number,c:number,date:string):QuizCardAttempt=>({testId,token:testId,slug:'sample',title:`Тест ${testId}`,status:'submitted',points,maxPoints,answered:n,total:n,results:answers(n,c),submittedAt:date})
const chain=[attempt('first',6,11,7,4,'2026-10-14'),attempt('zero',0,7,5,0,'2026-10-15'),attempt('repair',7,9,9,7,'2026-10-16T09:00:00Z'),attempt('latest',5,5,5,5,'2026-10-16T12:00:00Z')]
const mounted:Array<{root:ReturnType<typeof createRoot>;host:HTMLDivElement}>=[]
async function mount(items=chain,parent=true){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});await act(async()=>root.render(<QuizCard chain={items} parent={parent} assignment={<p>Точная запись МЭШ</p>} materials={<p>Оригинальные страницы</p>} />));return{host,root}}
afterEach(async()=>{for(const{root,host}of mounted.splice(0)){await act(async()=>root.unmount());host.remove()}vi.clearAllMocks()})
/** @see ../../docs/modules/assessments/quiz-chain-proposal.md */
describe('approved compact quiz table',()=>{
  it.each([true,false])('keeps the teacher source, exact counts, weighted aggregate and newest-first history; parent=%s',async parent=>{
    const{host}=await mount(chain,parent)
    expect([...host.querySelectorAll('tbody tr')].map(row=>row.getAttribute('data-test-id'))).toEqual(['repair','zero','first'])
    expect(host.querySelector<HTMLDetailsElement>('.day-quiz-history')?.open).toBe(false)
    expect(chain.map(item=>item.testId)).toEqual(['first','zero','repair','latest'])
    expect(host.querySelector('.day-quiz-chain-summary')?.textContent).toContain('18 / 32')
    expect(host.querySelector('.day-quiz-chain-summary')?.textContent).toContain('56%')
    expect(host.querySelector('[data-test-id="first"]')?.textContent).toContain('4/7')
    expect(host.querySelector('[data-test-id="first"]')?.textContent).toContain('6/11')
    expect(host.textContent).toContain('Точная запись МЭШ')
    expect(host.textContent).toContain('Оригинальные страницы')
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0)
    const meters=host.querySelectorAll('[role="meter"]');expect(meters[0].getAttribute('aria-valuenow')).toBe('100')
  })
  it('opens the same safe feedback inline without publishing the hidden non-spelling answer',async()=>{
    const{host}=await mount()
    await act(async()=>host.querySelector<HTMLButtonElement>('[data-test-id="repair"] button')!.click())
    const review=host.querySelector('[aria-label="Разбор теста «Тест repair»"]')
    expect(review?.textContent).toContain('Мой ответ')
    expect(review?.textContent).toContain('Вопрос 8')
    expect(review?.textContent).not.toContain('Закрытый ключ')
    expect(review?.textContent).toContain('Полный результат')
    expect(requestQuizFollowup).not.toHaveBeenCalled()
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Показать время теста «Тест repair»"]')!.click())
    expect(host.querySelectorAll('time')).toHaveLength(1)
    expect(requestQuizFollowup).not.toHaveBeenCalled()
  })
  it('updates manual counts without using updatedAt to reorder the old result',async()=>{
    const{host,root}=await mount()
    const changed=chain.map(item=>item.testId==='first'?{...item,updatedAt:'2026-11-01',results:answers(7,6),points:9}:item)
    await act(async()=>root.render(<QuizCard chain={changed} parent />))
    expect(host.querySelector('tbody tr')?.getAttribute('data-test-id')).toBe('repair')
    expect(host.querySelector('[data-test-id="first"]')?.textContent).toContain('6/7')
    expect(host.querySelector('.day-quiz-chain-summary')?.textContent).toContain('21 / 32')
  })
  it('uses a blue pending state after one click while the passing result stays green',async()=>{
    const result={...chain[2],points:8}
    const{host,root}=await mount([result])
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Создать новый тест с учётом всех попыток"]')!.click())
    expect(requestQuizFollowup).toHaveBeenCalledExactlyOnceWith(result.token,result.testId)
    expect(host.querySelector('[aria-label="Новый тест запрошен"]')?.hasAttribute('disabled')).toBe(true)
    expect(host.querySelector('.day-quiz-lineage-score')?.getAttribute('data-tone')).toBe('success')
    expect(host.querySelector('.day-quiz-request-state')?.textContent).toContain('ждём новый тест')
    await act(async()=>root.render(<QuizCard chain={[result,{...result,token:'next',testId:'next',status:'open',points:undefined,maxPoints:undefined}]} parent />))
    expect(host.querySelector('.day-quiz-request-state')).toBeNull()
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(1)
  })
  it('requests once after 100% and keeps earned results intact',async()=>{
    const{host}=await mount()
    const button=host.querySelector<HTMLButtonElement>('[aria-label="Создать новый тест с учётом всех попыток"]')!
    expect(button.disabled).toBe(false)
    await act(async()=>button.click())
    expect(requestQuizFollowup).toHaveBeenCalledExactlyOnceWith('latest','latest')
    expect(button.disabled).toBe(true)
    expect(host.querySelector('.day-quiz-request-state')?.textContent).toContain('Новый тест запрошен')
    expect(host.querySelector('.day-quiz-lineage-score')?.textContent).toContain('100%')
  })
  it('does not infer correct answers from a weighted score or mark pending as zero',async()=>{
    const{host}=await mount([{...chain[0],results:undefined}, {...chain[3],points:undefined,maxPoints:undefined,results:undefined}])
    expect(host.querySelector('[data-test-id="first"]')?.textContent).toContain('—/7')
    expect(host.querySelector('.day-quiz-lineage-score')?.textContent).toContain('Ждёт проверки')
    expect(host.querySelector('.day-quiz-lineage-current [role="meter"]')).toBeNull()
  })
  it('keeps the request retryable after a rejected write without inventing a pending job',async()=>{
    vi.mocked(requestQuizFollowup).mockRejectedValueOnce(new Error('Ошибка записи'))
    const{host}=await mount([chain[2]])
    const button=host.querySelector<HTMLButtonElement>('[aria-label="Создать новый тест с учётом всех попыток"]')!
    await act(async()=>button.click())
    expect(button.disabled).toBe(false)
    expect(host.querySelector('.day-quiz-request-state')).toBeNull()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Ошибка записи')
    await act(async()=>button.click())
    expect(button.disabled).toBe(true)
    expect(host.querySelector('.day-quiz-request-state')).not.toBeNull()
  })
})
describe('stable projection helpers',()=>{
  it('sorts missing and equal dates with deterministic IDs',()=>{
    expect(quizHistoryNewestFirst([{...chain[0],testId:'b',submittedAt:undefined,createdAt:'2026-10-15'},{...chain[0],testId:'a',submittedAt:'2026-10-15'}]).map(item=>item.testId)).toEqual(['a','b'])
  })
  it('separates partial, unanswered, pending and excluded',()=>{
    const results=answers(6,1);results[1].points=.5;results[2].answer='';results[3].points=null;results[4].skipped=true
    expect(quizAnswerCounts({...chain[0],results})).toEqual({correct:1,partial:1,incorrect:1,unanswered:1,pending:1,excluded:1})
  })
})
