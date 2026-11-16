import {expect,it} from 'vitest'
import {assignmentDigest,freezeCriteria,assertCriteriaCoverage,assignedCriteriaSources} from './criteria-contract.mjs'
const task={id:'english-letter',meshText:'Write about your favourite dish from your country.'}
const context={task,planRevision:4,sourceFingerprint:'a'.repeat(64)}
const criteria=[['topic','Блюдо своей страны','from your country'],['language','Письмо о блюде','Write about your favourite dish']].map(([id,action,quote])=>({id,action,quote,sourceRef:'mesh',required:true,skillId:`english-${id}`,skillLabel:action}))
const source={ref:'mesh',text:task.meshText,segments:[{kind:'requirement',text:task.meshText,criterionIds:['topic','language']}]}
const make=()=>freezeCriteria({taskId:task.id,planRevision:4,materialFingerprint:context.sourceFingerprint,assignmentDigest:assignmentDigest(task),sources:[source],criteria},context)
const review=contract=>({taskId:task.id,status:'verified',uploadIds:['photo'],items:criteria.map(c=>({stageId:c.id,status:'correct'})),criteriaFingerprint:contract.fingerprint,criteriaChecks:criteria.map(c=>({id:c.id,stageId:c.id,result:'confirmed',uploadId:'photo',location:'Строки 1–5',observation:'Сверено с видимым текстом'}))})
it('rejects credit without a frozen inventory, even without feature flags',()=>expect(()=>assertCriteriaCoverage({status:'verified'},null,context)).toThrow())
it('rejects omitted national-dish criterion despite correct grammar',()=>{const c=make(),r=review(c);r.criteriaChecks=r.criteriaChecks.filter(x=>x.id!=='topic');expect(()=>assertCriteriaCoverage(r,c,context)).toThrow(/Пропущен/);r.criteriaChecks.unshift({id:'topic',result:'not-met',uploadId:'photo',location:'Тема письма',observation:'Названо блюдо другой страны'});expect(()=>assertCriteriaCoverage(r,c,context)).toThrow(/Нельзя зачесть/)})
it('requires full source segmentation and every assigned source',()=>{expect(()=>freezeCriteria({...make(),sources:[{...source,segments:[{kind:'requirement',text:'Write',criterionIds:['topic']}]}]},context)).toThrow();expect(()=>freezeCriteria(make(),{...context,sourceRefs:['teacher:sheet']})).toThrow()})
it('preserves optional criteria, accepts complete evidence and rejects stale source',()=>{const c=make();expect(assertCriteriaCoverage(review(c),c,context)).toHaveLength(2);expect(()=>assertCriteriaCoverage(review(c),c,{...context,task:{...task,meshText:'Different assignment'}})).toThrow();expect(assertCriteriaCoverage({status:'cannot-assess'},null,context)).toEqual([])})
it('cannot switch off the national-dish requirement with an author boolean',()=>expect(()=>freezeCriteria({...make(),criteria:criteria.map(c=>({...c,required:false}))},context)).toThrow(/нельзя выключить/))
it('does not make an optional illustration a condition of credit for the required writing',()=>{
 const t={id:'writing',meshText:'Напиши текст. Нарисуй иллюстрацию по желанию.'},ctx={...context,task:t}
 const cs=[{id:'writing',skillId:'writing',skillLabel:'Текст',action:'Напиши текст',sourceRef:'mesh',quote:'Напиши текст.',required:true},{id:'drawing',skillId:'drawing',skillLabel:'Иллюстрация',action:'Нарисуй иллюстрацию',sourceRef:'mesh',quote:'Нарисуй иллюстрацию по желанию.',required:false,optionalBySource:{ref:'mesh',quote:'по желанию'}}]
 const c=freezeCriteria({taskId:t.id,planRevision:4,materialFingerprint:ctx.sourceFingerprint,assignmentDigest:assignmentDigest(t),sources:[{ref:'mesh',text:t.meshText,segments:[{kind:'requirement',text:t.meshText,criterionIds:cs.map(c=>c.id)}]}],criteria:cs},ctx)
 const r={taskId:t.id,status:'verified',uploadIds:['photo'],items:[{stageId:'work',status:'correct'}],criteriaFingerprint:c.fingerprint,criteriaChecks:cs.map((c,i)=>({id:c.id,stageId:'work',result:i?'not-met':'confirmed',uploadId:'photo',location:'Лист 1',observation:i?'Иллюстрации нет':'Текст написан'}))}
 expect(assertCriteriaCoverage(r,c,ctx)).toHaveLength(2)
})
it('cannot show all green stages when a required content criterion failed',()=>{
 const c=make(),r=review(c);r.status='partial';r.criteriaChecks[0].result='not-met'
 expect(()=>assertCriteriaCoverage(r,c,context)).toThrow(/Видимый результат/)
 r.items[0].status='incorrect'
 expect(assertCriteriaCoverage(r,c,context)).toHaveLength(2)
})
it('keeps fingerprints stable after Firestore map reordering and rejects changed material bytes',()=>{
 const c=make()
 expect(freezeCriteria({...c,criteria:c.criteria.map(x=>Object.fromEntries(Object.entries(x).reverse()))},context).fingerprint).toBe(c.fingerprint)
 expect(()=>assertCriteriaCoverage(review(c),c,{...context,sourceFingerprint:'different-material-hash'})).toThrow(/материал изменился/)
})
it('does not drop legacy teacher URLs or allow a missing material fence to rebase old text',()=>{
 const page={subjects:[{tasks:[task]}],materialLinks:{[task.id]:[{sourceType:'teacher-attachment',sourceRef:'',url:'https://example.org/sheet.pdf'}]}}
 const sources=assignedCriteriaSources(page,task.id)
 expect(sources.sourceRefs).toEqual(['https://example.org/sheet.pdf'])
 expect(()=>freezeCriteria({...make(),materialFingerprint:undefined},context)).toThrow(/обязательный отпечаток/)
 expect(()=>freezeCriteria(make(),{...context,...sources})).toThrow()
})
