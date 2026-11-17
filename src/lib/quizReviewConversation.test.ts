import {beforeEach,expect,it,vi} from 'vitest'
import {quizQuestionReview} from '../../packages/education-presentation/quiz-review-reply.mjs'
const state=vi.hoisted(()=>({rows:new Map<string,Record<string,any>>(),writes:0}))
const snap=(path:string)=>({exists:()=>state.rows.has(path),data:()=>state.rows.get(path),id:path.split('/').at(-1)})
vi.mock('./firebase',()=>({db:{}}))
vi.mock('firebase/auth',()=>({getAuth:()=>({currentUser:{uid:'student-device'}})}))
vi.mock('firebase/firestore',()=>({doc:(first:any,...args:any[])=>typeof first==='string'?[first,...args].join('/'):args.join('/'),collection:vi.fn(),query:vi.fn(),where:vi.fn(),limit:vi.fn(),onSnapshot:vi.fn(),serverTimestamp:()=>({seconds:200}),
 getDocFromServer:async(path:string)=>snap(path),runTransaction:async(_db:any,fn:any)=>fn({get:async(path:string)=>snap(path),set:(path:string,data:any)=>{state.writes++;state.rows.set(path,data)}})}))
vi.mock('./educationEventProducer',()=>({prepareEducationEvent:async(data:any)=>({...data,eventId:'a'.repeat(64)}),stagePreparedEducationEventInTransaction:(tx:any,event:any)=>tx.set(`educationEvents/${event.eventId}`,event)}))
import {sendQuizReviewReply} from './quizReviewConversation'
const activity={kind:'choice' as const,label:'Персонаж',instruction:'Выбери одного.',tokens:[{id:'a',text:'Первый'},{id:'b',text:'Второй'}]}
const guidance={question:'Кто дал приказ?',observation:'Сопоставь действия.',presentation:{version:1 as const,activity},source:{title:'Текст',edition:'Пример',section:'Глава',pages:'1',locator:'Абзац'}}
const review=quizQuestionReview('q',{seconds:100},guidance)
const reply={version:1 as const,sourceId:'review',checkedAt:review.checkedAt,correctedAt:review.correctedAt,step:{question:guidance.question,activity},intent:'answer' as const,value:JSON.stringify({selected:['a'],groups:{},written:{}})}
beforeEach(()=>{state.rows.clear();state.writes=0;state.rows.set('assignments/token',{familyId:'family',childId:'child',status:'submitted',submittedAt:{seconds:100},questions:[{id:'q'}],answers:{q:'b'}});state.rows.set('answerKeys/token',{entries:{q:{guidance}}})})
it('production sender writes the current model, immutable copy and existing event, with idempotent retry and unchanged assignment',async()=>{
 const before=JSON.stringify(state.rows.get('assignments/token'))
 const id=await sendQuizReviewReply('token','q',reply,' Моя мысль ','operation')
 expect(id).toBe('a'.repeat(64));expect(state.writes).toBe(3)
 const current=state.rows.get('quizStepReplies/token/items/q')!
 expect(current.reviewReply).toEqual(reply);expect(current.requestText).toBe('Моя мысль')
 expect(state.rows.get(`quizStepReplies/token/items/q/requests/${id}`)).toEqual(current)
 expect(state.rows.get(`educationEvents/${id}`)?.sourceRef).toEqual({kind:'help',documentPath:'quizStepReplies/token/items/q',quizToken:'token',taskId:'q'})
 expect(JSON.stringify(state.rows.get('assignments/token'))).toBe(before)
 expect(await sendQuizReviewReply('token','q',reply,' Моя мысль ','operation')).toBe(id);expect(state.writes).toBe(3)
})
it('production sender rejects a changed public model or different submitted attempt before creating a request',async()=>{
 for(const field of ['model','attempt']){
  if(field==='model')state.rows.set('answerKeys/token',{entries:{q:{guidance:{...guidance,question:'Другой вопрос?'}}}})
  else{state.rows.set('answerKeys/token',{entries:{q:{guidance}}});state.rows.get('assignments/token')!.submittedAt={seconds:101}}
  await expect(sendQuizReviewReply('token','q',reply,'','op')).rejects.toThrow('review_reply_stale');expect(state.writes).toBe(0)
 }
})
