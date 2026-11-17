/** @see ../docs/decisions/assessment-format-gates-2026-11-17.md */
/** @see ../docs/modules/assessments/format-plan.md */
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {subjectAdapters} from './decision-graph.mjs'

const text=value=>typeof value==='string'&&Boolean(value.trim())
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const kinds={selection:['single','multiple','figure'],production:['short','number'],explanation:['long'],dictation:['short']}

function historySummary(history){
 if(!history||history.schemaVersion!==1||!Array.isArray(history.attempts)||!history.attempts.length
  ||! /^[a-f0-9]{64}$/.test(history.next?.historyFingerprint??'')
  ||history.attempts.some(a=>!text(a.testId)||!Number.isFinite(a.earned)||!Number.isFinite(a.possible)||a.possible<=0||a.earned<0||a.earned>a.possible))throw Error('Нужна проверенная статистика quiz history, не догадка об успеваемости.')
 return {historyFingerprint:history.next.historyFingerprint,attempts:history.attempts.map(({testId,earned,possible})=>({testId,earned,possible}))}
}

export function buildFormatPlan(input){
 if(input?.version!==1||!Object.hasOwn(subjectAdapters,input.subjectAdapter)
  ||!['mixed-practice','vocabulary-dictation'].includes(input.purpose))throw Error('Неизвестная версия, предмет или назначение плана форматов.')
 const ids=input.questionIds
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!text(id))||new Set(ids).size!==ids.length)throw Error('Нужны от1до100 уникальных ID вопросов.')
 const history=input.history===null?null:historySummary(input.history)
 if(!history&&!text(input.historyGapReason))throw Error('Неизвестная история требует явной причины, а не вымышленного результата.')
 const dictation=input.purpose==='vocabulary-dictation',n=ids.length
 if(!dictation&&n<2)throw Error('Смешанная самопроверка требует хотя бы два вопроса.')
 const supported=history&&history.attempts[0].earned/history.attempts[0].possible<.85
 const profile=dictation?'dictation':supported?'supported':'mixed'
 const selection=dictation?0:n===2?1:Math.min(n-2,Math.ceil(n*(supported?2/3:1/2)))
 const explanation=dictation||n===2?0:1,production=dictation?0:n-selection-explanation
 const groups=[]
 let c=selection,p=production
 while(c||p){if(c){groups.push('selection');c--}if(p){groups.push('production');p--}}
 if(explanation)groups.push('explanation')
 const slots=ids.map((questionId,index)=>{
  const group=dictation?'dictation':groups[index],allowedKinds=kinds[group]
  return {questionId,group,allowedKinds:[...allowedKinds],recommendedKind:group==='production'&&input.subjectAdapter==='math'?'number':allowedKinds[0],component:'QuizQuestionCard'}
 })
 return {version:1,profile,inputFingerprint:createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex'),
  counts:dictation?{dictation:n}:{selection,production,explanation},slots}
}

export function validateFormatPlan(plan,spec){
 try{
  const packet=plan?.formatPlan
  if(!packet)throw Error('Нет обязательного formatPlan: сначала выполните quiz:plan.')
  const expected=buildFormatPlan(packet.input)
  if(!isDeepStrictEqual(packet.blueprint,expected))throw Error('План форматов изменён или устарел: пересчитайте quiz:plan.')
  if(packet.input.subjectAdapter!==plan.subjectAdapter&&plan.subjectAdapter!==undefined)throw Error('План форматов относится к другому предмету.')
  if(Boolean(plan.dictation)!==(packet.input.purpose==='vocabulary-dictation'))throw Error('Исключение диктанта требует отдельную подтверждённую ветку dictation.')
  const questions=spec?.questions
  if(!Array.isArray(questions)||questions.length!==expected.slots.length)throw Error('Количество вопросов не совпадает с планом форматов.')
  for(const [i,slot] of expected.slots.entries()){
   const q=questions[i]
   if(q.id!==slot.questionId||!slot.allowedKinds.includes(q.kind))throw Error(`Вопрос ${slot.questionId}: ожидается ${slot.group} (${slot.allowedKinds.join('/')}), получено ${q.kind}.`)
   if(slot.group==='selection'){
    const options=q.options,key=q.answer?.correct
    if(!Array.isArray(options)||options.length<2||options.some(o=>!text(o?.id)||!text(o?.label))||new Set(options.map(o=>o.id)).size!==options.length)throw Error(`Вопрос ${q.id}: нужны разные подписанные варианты выбора.`)
    const selected=q.kind==='multiple'?key:[key]
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!options.some(o=>o.id===id)))throw Error(`Вопрос ${q.id}: ключ не соответствует вариантам выбора.`)
   }
  }
  return []
 }catch(error){return [error.message]}
}

/** Called with the lineage already read by create/revise-open; no new Firestore read path. */
export function assertFormatHistory(plan,statistics){
 if(!plan.formatPlan?.input.history||!isDeepStrictEqual(historySummary(plan.formatPlan.input.history),historySummary(statistics)))throw Error('Вход форматов не соответствует свежей полной истории: выполните quiz history заново.')
}
