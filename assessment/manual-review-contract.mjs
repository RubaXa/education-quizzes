import {createHash} from 'node:crypto'
/** @see ../docs/modules/reviews/criteria-and-knowledge.md#criteria */
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export const quizAttemptDigest=(assignment,key)=>hash({assignment,key})
export const quizReviewDigest=review=>hash({entries:review?.entries??null,attemptFingerprint:review?.attemptFingerprint??null})
export const quizSkillId=(subject,topic)=>`quiz-topic-${hash({subject,topic}).slice(0,24)}`
export function assertQuizReviewRevision(previous,review){
 if(quizReviewDigest(previous)===quizReviewDigest(review))return 'unchanged'
 if(review.priorReviewFingerprint!==quizReviewDigest(previous))throw Error('Предыдущий разбор изменился: коррекция требует свежий экспорт.')
 if(previous?.entries&&(Object.keys(previous.entries).length||previous.attemptFingerprint!==review.attemptFingerprint)&&!review.correctionReason?.trim())throw Error('Изменение проверки требует причины коррекции.')
 return 'changed'
}
export function privateQuizKey(key,privateRecord){return {...key,entries:Object.fromEntries(Object.entries(key?.entries??{}).map(([id,value])=>{const {criteria:_criteria,...entry}=value;return [id,{...entry,...(privateRecord?.rubrics?.[id]?{criteria:privateRecord.rubrics[id]}:{})}]}))}}
export function assertQuestionRubric(question,entry){
 const rubric=entry?.criteria
 if(!Array.isArray(rubric)||!rubric.length||new Set(rubric.map(c=>c.id)).size!==rubric.length||rubric.some(c=>!c.id||!c.description?.trim()||!c.skillId?.trim()||!c.skillLabel?.trim()||!Number.isFinite(c.maxPoints)||c.maxPoints<=0)||Math.abs(rubric.reduce((n,c)=>n+c.maxPoints,0)-question.points)>1e-8)throw Error(`Вопрос ${question.id}: нужна полная рубрика критериев с суммой баллов вопроса.`)
 return rubric
}
export function assertManualQuizReview(assignment,key,review){
 if(assignment?.status!=='submitted'||!assignment.familyId||!assignment.childId||review.attemptFingerprint!==quizAttemptDigest(assignment,key))throw Error('Попытка или ключ изменились; нужен свежий адресный экспорт.')
 if(assignment.questions.some(q=>!key?.entries?.[q.id]||q.kind!=='long'&&key.entries[q.id].correct===undefined&&!key.entries[q.id].accepted?.length))throw Error('Ключ не покрывает все вопросы попытки.')
 const entries=review.entries
 if(!entries||typeof entries!=='object'||Array.isArray(entries))throw Error('Нужны адресные результаты вопросов.')
 const checked=[]
 for(const [id,entry] of Object.entries(entries)){
  const question=assignment.questions.find(q=>q.id===id),answer=assignment.answers?.[id]
  if(!question||!(typeof answer==='string'?answer.trim():Array.isArray(answer)&&answer.length)||!Number.isFinite(entry.points)||entry.points<0||entry.points>question.points||!entry.explanation?.trim())throw Error('Чужой/неотвеченный вопрос или недопустимый результат.')
  const rubric=assertQuestionRubric(question,key.entries?.[id]),checks=entry.criteriaChecks
  if(!Array.isArray(checks)||checks.length!==rubric.length||new Set(checks.map(c=>c.id)).size!==checks.length||rubric.some(c=>!checks.some(f=>f.id===c.id)))throw Error('Разбор пропустил критерий вопроса.')
  for(const c of rubric){const f=checks.find(x=>x.id===c.id);if(!Number.isFinite(f.points)||f.points<0||f.points>c.maxPoints||!f.observation?.trim())throw Error('Нужна проверка каждого критерия в пределах его баллов.');checked.push({...c,id:`${id}:${c.id}`,finding:{result:f.points===c.maxPoints?'confirmed':f.points===0?'not-met':'partial',score:f.points,maxPoints:c.maxPoints,observation:f.observation,uploadId:`answer:${id}`,location:`question:${id}`}})}
  if(Math.abs(checks.reduce((n,c)=>n+c.points,0)-entry.points)>1e-8)throw Error('Итог вопроса не равен сумме критериев.')
 }
 for(const q of assignment.questions.filter(q=>q.kind==='long'))if(typeof assignment.answers?.[q.id]==='string'&&assignment.answers[q.id].trim()&&!entries[q.id])throw Error('Открытый ответ остался непроверенным.')
 return checked
}
export function publicManualReview(review){return {entries:Object.fromEntries(Object.entries(review.entries).map(([id,e])=>[id,{points:e.points,explanation:e.explanation,...(e.source?{source:e.source}:{}),...(e.learning?{learning:e.learning}:{})}]))}}
