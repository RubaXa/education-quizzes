import {expect,it} from 'vitest'
import {exportQuizParentReview,publishQuizParentReview} from './quiz-parent-review.mjs'
const analysis={version:1,answer:'Первый персонаж поручил открыть; второй закрыл дверь.',difference:'В условном ответе два действия переставлены местами.',method:{name:'Поручение и действие',reason:'Сопоставляем две части проверенного источника.',steps:['Прочитать поручение','Сопоставить поступок']},blocks:[{kind:'text',title:'Поручение',text:'В источнике поручено открыть дверь.'},{kind:'text',title:'Действие',text:'Персонаж закрыл дверь вопреки поручению.'}],source:{label:'Литературный учебный пример',location:'Глава VI, страница 156'}}
function fixture(){
 const rows=new Map(Object.entries({'assignments/quiz':{familyId:'family',childId:'child',testId:'test',title:'Пример',status:'submitted',submittedAt:{seconds:100,nanoseconds:0},questions:[{id:'q',kind:'single',prompt:'Сопоставь действия.',points:1}],answers:{q:'wrong'}},'answerKeys/quiz':{entries:{q:{correct:'right',guidance:{question:'Что поручено сделать?'}}}},'families/family':{active:true},'families/family/children/child':{active:true}}))
 const snap=p=>({exists:rows.has(p),data:()=>structuredClone(rows.get(p))}),writes=[]
 const db={doc:p=>({path:p,get:async()=>snap(p)}),runTransaction:async fn=>fn({get:async r=>snap(r.path),set:(r,v)=>{writes.push(r.path);rows.set(r.path,structuredClone(v))},create:(r,v)=>{if(rows.has(r.path))throw Error('exists');writes.push(r.path);rows.set(r.path,structuredClone(v))}})}
 return {db,rows,writes}
}
async function packet(db){const d=await exportQuizParentReview(db,{quizToken:'quiz',questionId:'q'});return Object.fromEntries(Object.entries({...d,analysis,reason:'Проверено поручение, поступок и наблюдаемая ошибка условного ответа.',sourceEvidence:['public-domain:teaching-example:156'],semanticChecked:true,sourceChecked:true,studentSafetyChecked:true}).filter(([k])=>!['privateOnly','assignment','result','parent','context'].includes(k)))}
it('publishes only parent material and immutable audit; scores, public key, original answer and pupil guidance stay unchanged',async()=>{
 const {db,rows,writes}=fixture(),before=structuredClone([...rows]),p=await packet(db)
 expect(await publishQuizParentReview(db,p)).toMatchObject({valid:true,applied:false});expect(writes).toHaveLength(0)
 expect(await publishQuizParentReview(db,p,{apply:true})).toMatchObject({verified:true,gradeChanged:false,learnerChanged:false})
 expect(writes).toHaveLength(3);expect(writes.every(p=>p.startsWith('quizParentReview'))).toBe(true)
 for(const [path,value] of before)expect(rows.get(path)).toEqual(value)
 expect(rows.get('quizParentReviews/quiz/items/q').analysis).toEqual(analysis)
 expect(rows.get('quizParentReviews/quiz/items/q').sourceEvidence).toBeUndefined()
 const fresh=await packet(db);expect(await publishQuizParentReview(db,fresh,{apply:true})).toMatchObject({unchanged:true});expect(writes).toHaveLength(3)
 fresh.analysis={...analysis,difference:'Теперь уточнено конкретное противопоставление двух действий.'}
 expect(await publishQuizParentReview(db,fresh,{apply:true})).toMatchObject({verified:true})
 expect([...rows.keys()].filter(p=>p.includes('/history/'))).toHaveLength(2)
})
it('rejects changed source, owner or grade and incomplete/question-only parent content before any write',async()=>{
 for(const mutation of ['source','grade','owner','missing-answer','missing-method','only-question','unknown-field']){
  const {db,rows,writes}=fixture(),p=await packet(db)
  if(mutation==='source')rows.get('assignments/quiz').questions[0].prompt='Другое условие'
  if(mutation==='grade')rows.get('answerKeys/quiz').entries.q.correct='wrong'
  if(mutation==='owner')p.childId='other'
  if(mutation==='missing-answer')p.analysis={...analysis,answer:''}
  if(mutation==='missing-method')p.analysis={...analysis,method:undefined}
  if(mutation==='only-question')p.analysis={...analysis,answer:'Что поручено сделать?'}
  if(mutation==='unknown-field')p.extra='not allowed'
  await expect(publishQuizParentReview(db,p,{apply:true})).rejects.toThrow();expect(writes).toHaveLength(0)
 }
})
