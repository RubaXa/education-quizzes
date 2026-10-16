import { describe, expect, it, vi } from 'vitest'
import type { AnswerKey, Assignment, ManualReview } from './quiz'
import { watchQuizOutcome, type QuizOutcome } from './watchQuizOutcome'
const calls=vi.hoisted(()=>({assignment:undefined as ((value:Assignment)=>void)|undefined,key:undefined as ((value:AnswerKey)=>void)|undefined,review:undefined as ((value:ManualReview|undefined)=>void)|undefined,stops:[vi.fn(),vi.fn(),vi.fn()]}))
vi.mock('./store',()=>({watchAssignment:vi.fn((_token,onChange)=>{calls.assignment=onChange;return calls.stops[0]}),watchAnswerKey:vi.fn((_token,onChange)=>{calls.key=onChange;return calls.stops[1]}),watchReview:vi.fn((_token,onChange)=>{calls.review=onChange;return calls.stops[2]})}))
import { watchAnswerKey,watchReview } from './store'
/** @see ../../docs/product/quiz-chain-proposal.md */
describe('shared outcomes keep already loaded question results',()=>{
 it('updates manual grading through the same key and review listeners, then unsubscribes once',()=>{
  vi.clearAllMocks();const values:QuizOutcome[]=[];const stop=watchQuizOutcome('sample',value=>values.push(value),vi.fn())
  const assignment={schemaVersion:1,testId:'sample',title:'Пример',subject:'Русский',startedAt:null,updatedAt:null,submittedAt:null,status:'submitted',questions:[{id:'one',kind:'long',prompt:'Объясни',points:2}],answers:{one:'Попытка'}} as Assignment
  calls.assignment!(assignment);calls.key!({entries:{one:{}}});calls.review!(undefined)
  expect(values.at(-1)?.score).toBeUndefined();expect(values.at(-1)?.results?.[0].points).toBeNull()
  calls.review!({entries:{one:{points:2,explanation:'Подтверждено'}}})
  expect(values.at(-1)?.score).toEqual({points:2,maxPoints:2});expect(values.at(-1)?.results?.[0].points).toBe(2)
  calls.assignment!({...assignment,updatedAt:'later'})
  expect(watchAnswerKey).toHaveBeenCalledTimes(1);expect(watchReview).toHaveBeenCalledTimes(1)
  stop();for(const fn of calls.stops)expect(fn).toHaveBeenCalledTimes(1)
 })
 it('does not read or expose a key for an open attempt',()=>{
  vi.clearAllMocks();const onChange=vi.fn();const stop=watchQuizOutcome('open',onChange,vi.fn())
  calls.assignment!({status:'open',questions:[],answers:{}} as unknown as Assignment)
  expect(watchAnswerKey).not.toHaveBeenCalled();expect(watchReview).not.toHaveBeenCalled();expect(onChange.mock.lastCall?.[0].results).toBeUndefined();stop()
 })
})
