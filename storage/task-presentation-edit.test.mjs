import {describe,it,expect} from 'vitest'
import {editTaskPresentation} from './task-presentation-edit.mjs'
class Version{constructor(n){this.n=n}isEqual(other){return this.n===other?.n}}
const copy=v=>structuredClone(v)
function setup(){
 const source={kind:'teacher-file',ref:'attachment:synthetic',label:'Условный лист',excerpt:'Найдите сумму двух чисел.'}
 const support={revision:1,state:'unknown',skill:'Сумма',evidence:'Условная подготовка, не оценка работы.',evidenceRefs:['synthetic'],facts:[{label:'Числа',value:'2 и 3'}],find:'Сумма двух чисел.',firstQuestion:'Как связаны два данных числа?'}
 const guide={kind:'worked-solution',presentation:'math-route',routeProfile:'compact',revision:1,boundary:'Иной верный способ допустим.',stages:[{id:'solution',role:'solution',title:'Сложение',expected:'Сложим данные величины.',source,hintPreview:'Что объединяем?',revealPreview:'Показать сложение.',rows:[{label:'Действие',value:'Сложить два числа.'}]},{id:'answer',role:'answer',title:'Ответ',expected:'Проверим сумму обратным действием.',source,hintPreview:'Как проверить сумму?',revealPreview:'Показать проверку.',answer:'5',verification:[{label:'Контроль',value:'5 − 3 = 2'}],rows:[{label:'Контроль',value:'Проверка вычитанием.'}]}]}
 const request={id:'request-original',state:'needed',resolvedTopic:null,sourceRef:'synthetic',question:'Какая страница назначена?',photoPrompt:'Пришли нужную страницу.'}
 const problem={id:'mesh-1-p1',number:1,title:'Сложение',original:{text:'Найдите сумму двух чисел.',attachmentRef:'attachment:synthetic'},support}
 const task={id:'mesh-1',kind:'written',meshText:'Из файла.',materialRequest:request,problems:[problem]}
 const common={familyId:'synthetic-family',childId:'synthetic-child',date:'2026-11-01',targetDate:'2026-11-02',planRevision:7,sourceRevision:4,subjects:[{id:'math',tasks:[task]}],unrelated:{keep:true}}
 const rows=new Map([['dayOwners/student',{familyId:common.familyId,childId:common.childId,date:common.date}],['dayPages/student',{...copy(common),kind:'student'}],['dayPages/parent',{...copy(common),kind:'parent',studentToken:'student'}],['dayTaskGuides/student/items/mesh-1-p1',{familyId:common.familyId,childId:common.childId,taskId:problem.id,sourceRevision:4,guide,other:'preserve'}]])
 const versions=new Map([...rows.keys()].map(k=>[k,1]));const reads=[];let writes=0;let beforeTransaction=null,afterCommit=null
 const snap=path=>({exists:rows.has(path),ref:{path},updateTime:new Version(versions.get(path)),data:()=>copy(rows.get(path))})
 const db={doc:path=>({path}),getAll:async(...refs)=>{reads.push(refs.map(r=>r.path));return refs.map(r=>snap(r.path))},runTransaction:async fn=>{
  beforeTransaction?.();const pending=[];const result=await fn({getAll:async(...refs)=>refs.map(r=>snap(r.path)),update:(ref,patch)=>pending.push([ref.path,copy(patch)])})
  for(const [path,patch] of pending){rows.set(path,{...rows.get(path),...patch});versions.set(path,versions.get(path)+1);writes++}afterCommit?.();return result
 }}
 const nextGuide=copy(guide);nextGuide.revision=2;nextGuide.method={name:'Сложение данных величин',reason:'Нужно найти общий итог двух чисел.',steps:['Выделить два слагаемых','Сложить их и проверить вычитанием']};for(const stage of nextGuide.stages){stage.rows=[];stage.blocks=[{kind:'text',text:'Сохраняем исходный правильный путь решения.'}]}
 const packet={pageId:'student',parentPageId:'parent',familyId:common.familyId,childId:common.childId,expectedPlanRevision:7,reason:'Родитель попросил краткое предметное представление.',changes:[{taskId:problem.id,expectedSupportRevision:1,support:{...copy(support),revision:2,facts:[{label:'Первое число',value:'2'},{label:'Второе число',value:'3'}]},expectedGuideRevision:1,sourceRevision:4,guide:nextGuide}]}
 return {db,rows,versions,reads,packet,request,get writes(){return writes},before:fn=>{beforeTransaction=fn},after:fn=>{afterCommit=fn},mutate:(path,change)=>{rows.set(path,change(copy(rows.get(path))));versions.set(path,(versions.get(path)??0)+1)}}
}
describe('addressed task presentation edit',()=>{
 it('dry-runs without writes and applies both roles plus a closed guide atomically with exact readback',async()=>{
  const f=setup(),before=copy(f.rows.get('dayPages/student'))
  expect(await editTaskPresentation(f.db,f.packet)).toMatchObject({valid:true,applied:false});expect(f.writes).toBe(0)
  expect(await editTaskPresentation(f.db,f.packet,{apply:true,now:'synthetic-time'})).toMatchObject({verified:true,changes:1,guides:1,presentationRevision:1})
  expect(f.writes).toBe(3)
  for(const role of ['student','parent']){const page=f.rows.get('dayPages/'+role);expect(page.subjects[0].tasks[0].problems[0].support).toEqual(f.packet.changes[0].support);expect(page.planRevision).toBe(7);expect(page.sourceRevision).toBe(4);expect(page.unrelated).toEqual(before.unrelated);expect(page.subjects[0].tasks[0].problems[0].original).toEqual(before.subjects[0].tasks[0].problems[0].original)}
  const guide=f.rows.get('dayTaskGuides/student/items/mesh-1-p1');expect(guide.other).toBe('preserve');expect(guide.guideEdits[0].guide.revision).toBe(1)
  expect(f.reads.at(-1)).toEqual(['dayPages/student','dayPages/parent','dayTaskGuides/student/items/mesh-1-p1'])
  await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/CAS|Ревизия/)
 })
 it.each(['foreign-family','wrong-binding','missing-parent','missing-owner','missing-guide','foreign-guide'])('rejects %s before mutation',async kind=>{
  const f=setup();if(kind==='foreign-family')f.packet.familyId='other-family';if(kind==='wrong-binding')f.rows.get('dayPages/parent').studentToken='other';if(kind==='missing-parent')f.rows.delete('dayPages/parent');if(kind==='missing-owner')f.rows.delete('dayOwners/student');if(kind==='missing-guide')f.rows.delete('dayTaskGuides/student/items/mesh-1-p1');if(kind==='foreign-guide')f.rows.get('dayTaskGuides/student/items/mesh-1-p1').childId='other'
  await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow();expect(f.writes).toBe(0)
 })
 it.each(['owner','student','parent','guide'])('CAS fences concurrent %s changes before all writes',async target=>{
  const f=setup(),path={owner:'dayOwners/student',student:'dayPages/student',parent:'dayPages/parent',guide:'dayTaskGuides/student/items/mesh-1-p1'}[target];f.before(()=>f.mutate(path,v=>({...v,concurrent:true})))
  await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/CAS/);expect(f.writes).toBe(0)
 })
 it.each(['original','support-evidence','first-question','answer','verification','source','profile','boundary','duplicate'])('rejects immutable or overlapping %s edits',async kind=>{
  const f=setup(),c=f.packet.changes[0]
  if(kind==='original')c.original={text:'Подменённое условие'}
  if(kind==='support-evidence')c.support.evidence='Другая попытка'
  if(kind==='first-question')c.support.firstQuestion='Подсказывающий новый вопрос'
  if(kind==='answer')c.guide.stages[1].answer='6'
  if(kind==='verification')c.guide.stages[1].verification=[]
  if(kind==='source')c.guide.stages[0].source.excerpt='Другое условие'
  if(kind==='profile')c.guide.routeProfile='extended'
  if(kind==='boundary')c.guide.boundary='Только этот метод обязателен'
  if(kind==='duplicate')f.packet.changes.push(copy(c))
  await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow();expect(f.writes).toBe(0)
 })
 it('rejects a missing source model and detects corrupted readback',async()=>{
  const f=setup();f.packet.changes[0].support.facts=[];await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/facts/);expect(f.writes).toBe(0)
  const g=setup();g.after(()=>g.rows.get('dayPages/parent').unrelated={keep:false});await expect(editTaskPresentation(g.db,g.packet,{apply:true})).rejects.toThrow(/Readback/)
 })
 function materialPacket(f){const presentation={version:1,available:['Workbook, страницы 19–20'],missing:['Workbook, страница 22'],checkedSources:['Проверен условный семейный архив'],reason:'Назначено упражнение на другой странице.',action:'Прислать страницу 22.',checkedAt:'2026-11-01T12:00:00Z',coverage:{collectionId:'synthetic-workbook',availablePages:[19,20],missingPages:[22]}};f.packet.changes=[{taskId:'mesh-1',materialRequest:{...copy(f.request),presentation}}];return presentation}
 it('uses the same prose gate as ordinary publication before writing',async()=>{
  const f=setup(),p=materialPacket(f);p.checkedSources=['Архив:192 фото']
  await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/читаемые пробелы/);expect(f.writes).toBe(0)
 })
 it('repairs root material presentation without changing its source state or repeating a replay',async()=>{const f=setup();materialPacket(f);expect(await editTaskPresentation(f.db,f.packet,{apply:true})).toMatchObject({verified:true,guides:0});expect(f.rows.get('dayPages/student').subjects[0].tasks[0].materialRequest.state).toBe('needed');const writes=f.writes;await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/повторная запись/);expect(f.writes).toBe(writes)})
 it.each(['state','resolved','overlap'])('rejects material %s changes',async kind=>{const f=setup(),p=materialPacket(f);if(kind==='state')f.packet.changes[0].materialRequest.state='resolved';if(kind==='resolved')f.packet.changes[0].materialRequest.resolvedTopic='Invented';if(kind==='overlap')p.coverage.missingPages=[20];await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow();expect(f.writes).toBe(0)})
 it('checks exact continuation ownership/target and fences it in the same transaction',async()=>{
  const f=setup(),p=materialPacket(f),token='synthetic-student-token-123456';p.continuation={label:'Уже имеющиеся страницы',dayToken:token,taskId:'mesh-old'}
  f.rows.set('dayOwners/'+token,{familyId:f.packet.familyId,childId:f.packet.childId});f.rows.set('dayPages/'+token,{kind:'student',familyId:f.packet.familyId,childId:f.packet.childId,subjects:[{tasks:[{id:'mesh-old'}]}]});for(const path of ['dayOwners/'+token,'dayPages/'+token])f.versions.set(path,1)
  expect(await editTaskPresentation(f.db,f.packet)).toMatchObject({valid:true})
  f.rows.get('dayOwners/'+token).childId='foreign';await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/Continuation/);expect(f.writes).toBe(0)
  f.rows.get('dayOwners/'+token).childId=f.packet.childId;f.before(()=>f.mutate('dayPages/'+token,v=>({...v,subjects:[]})));await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/CAS/);expect(f.writes).toBe(0)
 })
 it('combines addressed root and leaf changes without touching criteria, progress or other subjects',async()=>{
  const f=setup(),leaf=copy(f.packet.changes[0]);materialPacket(f);f.packet.changes.push(leaf)
  const criteriaPath='dayTaskGuides/student/items/mesh-1-p1/criteriaContract/current',progressPath='dayProgress/student/items/mesh-1-p1'
  f.rows.set(criteriaPath,{fingerprint:'synthetic-frozen'});f.rows.set(progressPath,{status:'verified',checkedAt:'previous-check',history:[{status:'partial'}]})
  const priorProgress=copy(f.rows.get(progressPath));expect(await editTaskPresentation(f.db,f.packet,{apply:true})).toMatchObject({verified:true,changes:2,guides:1})
  expect(f.rows.get(progressPath)).toEqual(priorProgress);expect(f.rows.get(criteriaPath)).toEqual({fingerprint:'synthetic-frozen'});expect(f.reads.flat()).not.toContain(criteriaPath);expect(f.reads.flat()).not.toContain(progressPath)
  for(const role of ['student','parent']){const task=f.rows.get('dayPages/'+role).subjects[0].tasks[0];expect(task.materialRequest.presentation).toBeDefined();expect(task.problems[0].support.revision).toBe(2)}
 })
 it('rejects a lost continuation target and an arbitrary external URL',async()=>{
  const f=setup(),p=materialPacket(f),token='synthetic-student-token-123456';p.continuation={label:'Существующий материал',dayToken:token,taskId:'mesh-old'}
  f.rows.set('dayOwners/'+token,{familyId:f.packet.familyId,childId:f.packet.childId});f.rows.set('dayPages/'+token,{kind:'student',familyId:f.packet.familyId,childId:f.packet.childId,subjects:[]})
  await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/отсутствует/);expect(f.writes).toBe(0)
  p.continuation.url='https://example.invalid/foreign';await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/внутренний/);expect(f.writes).toBe(0)
 })
})

it('links an existing stage to an assigned same-subject quiz, preserving guides, attempts and decisions',async()=>{
 const f=setup(),token='synthetic-stage-quiz-token-123'
 const guidePath='dayTaskGuides/student/items/mesh-1'
 const guide={familyId:f.packet.familyId,childId:f.packet.childId,taskId:'mesh-1',guide:{revision:3,stages:[{id:'oral'}]}}
 f.rows.set(guidePath,copy(guide));f.versions.set(guidePath,1)
 for(const role of ['student','parent'])f.rows.get('dayPages/'+role).testPlacements=[{subjectId:'math',token}]
 f.packet.changes=[{taskId:'mesh-1',expectedGuideRevision:3,expectedStageAssessments:[],stageAssessments:[{stageId:'oral',title:'Готовность',scope:'Самопроверка, не запись речи.',token}]}]
 expect(await editTaskPresentation(f.db,f.packet,{apply:true})).toMatchObject({verified:true})
 expect(f.rows.get(guidePath)).toEqual(guide)
 expect(f.writes).toBe(2)
 for(const role of ['student','parent'])expect(f.rows.get('dayPages/'+role).subjects[0].tasks[0].stageAssessments).toEqual(f.packet.changes[0].stageAssessments)
 await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/CAS/)
})
it.each(['other-subject','missing-stage','private-answer','wrong-guide-revision'])('blocks invalid stage assessment %s before writes',async kind=>{
 const f=setup(),token='synthetic-stage-quiz-token-123',path='dayTaskGuides/student/items/mesh-1'
 f.rows.set(path,{familyId:f.packet.familyId,childId:f.packet.childId,taskId:'mesh-1',guide:{revision:1,stages:[{id:'oral'}]}});f.versions.set(path,1)
 for(const role of ['student','parent'])f.rows.get('dayPages/'+role).testPlacements=[{subjectId:kind==='other-subject'?'english':'math',token}]
 const link={stageId:kind==='missing-stage'?'absent':'oral',title:'Готовность',scope:'Самопроверка по тексту.',token}
 if(kind==='private-answer')link.answer='PRIVATE'
 f.packet.changes=[{taskId:'mesh-1',expectedGuideRevision:kind==='wrong-guide-revision'?2:1,expectedStageAssessments:[],stageAssessments:[link]}]
 await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow();expect(f.writes).toBe(0)
})

it('corrects a stale learner boundary with CAS while preserving scope, source and all stages',async()=>{
 const f=setup(),flow={version:1,scope:'Только назначенное упражнение.',boundary:'Запись ещё не видна.',source:{pageId:'book:1'},goal:'Выполнить упражнение.',stages:[{id:'work'}]}
 for(const role of ['student','parent'])f.rows.get('dayPages/'+role).subjects[0].tasks[0].learnerFlow=copy(flow)
 f.packet.changes=[{taskId:'mesh-1',expectedLearnerFlowBoundary:flow.boundary,learnerFlowBoundary:'Запись принята. Другие упражнения не назначены.'}]
 expect(await editTaskPresentation(f.db,f.packet,{apply:true})).toMatchObject({verified:true})
 expect(f.rows.get('dayPages/student').subjects[0].tasks[0].learnerFlow).toEqual({...flow,boundary:f.packet.changes[0].learnerFlowBoundary})
 await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/CAS/)
})

function unitPacket(f,{guide=false}={}){
 for(const role of ['student','parent']){
  const page=f.rows.get('dayPages/'+role);delete page.subjects[0].tasks[0].problems
  page.taskPageRefs={'mesh-1':['book#44','book#45']}
 }
 if(guide){
  const path='dayTaskGuides/student/items/mesh-1';f.rows.set(path,{familyId:f.packet.familyId,childId:f.packet.childId,taskId:'mesh-1',guide:{revision:3,stages:[{id:'first'},{id:'second'}]}});f.versions.set(path,1)
 }
 f.packet.changes=[{taskId:'mesh-1',expectedAssignmentUnits:null,...(guide?{expectedGuideRevision:3}:{}),assignmentUnits:{version:1,sourceText:'Из файла.',items:[
  {id:'one',title:'Упражнение1',kind:'written',sourceRefs:['book#44'],original:'Write one.',instructions:['Выполни первое упражнение.'],...(guide?{guideStageIds:['first']}: {})},
  {id:'two',title:'Упражнение2',kind:'oral',sourceRefs:['book#45'],original:'Read two.',instructions:['Ответь на вопрос второго упражнения.'],...(guide?{guideStageIds:['second']}: {})}
 ]}}]
}
it.each([false,true])('publishes units with guide=%s using owner/CAS and both-role readback while preserving other data',async guide=>{
 const f=setup();unitPacket(f,{guide});const before=copy(f.rows.get('dayPages/student')),privateBefore=copy(f.rows.get('dayTaskGuides/student/items/mesh-1'))
 expect(await editTaskPresentation(f.db,f.packet,{apply:true})).toMatchObject({verified:true,changes:1})
 expect(f.writes).toBe(2)
 for(const role of ['student','parent']){
  const page=f.rows.get('dayPages/'+role);expect(page.subjects[0].tasks[0].assignmentUnits).toEqual(f.packet.changes[0].assignmentUnits)
  expect(page.planRevision).toBe(before.planRevision);expect(page.unrelated).toEqual(before.unrelated)
 }
 expect(f.rows.get('dayTaskGuides/student/items/mesh-1')).toEqual(privateBefore)
 await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow(/CAS/)
})
it.each(['foreign-page','missing-guide-stage','private-key','changed-mesh','stale-guide'])('blocks units %s before writing',async kind=>{
 const f=setup();unitPacket(f,{guide:true});const c=f.packet.changes[0],unit=c.assignmentUnits.items[1]
 if(kind==='foreign-page')unit.sourceRefs=['other-child#44']
 if(kind==='missing-guide-stage')unit.guideStageIds=[]
 if(kind==='private-key')unit.answer='PRIVATE'
 if(kind==='changed-mesh')c.assignmentUnits.sourceText='Уже другое условие.'
 if(kind==='stale-guide')c.expectedGuideRevision=2
 await expect(editTaskPresentation(f.db,f.packet,{apply:true})).rejects.toThrow();expect(f.writes).toBe(0)
})
