/** @see ../docs/shared/design/student-review-step.md#quiz-dialogue */
import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {initializeApp as clientApp,deleteApp as deleteClientApp} from 'firebase/app'
import {connectAuthEmulator,getAuth,signInAnonymously} from 'firebase/auth'
import {connectFirestoreEmulator,getDoc,setDoc,doc,getFirestore,serverTimestamp,writeBatch} from 'firebase/firestore'
import {initializeApp as adminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app'
import {getFirestore as adminDb} from 'firebase-admin/firestore'
import {createEducationEvent} from '../packages/education-events/envelope.mjs'
import {quizQuestionReview} from '../packages/education-presentation/quiz-review-reply.mjs'
import {prepareEventTaskArtifact} from '../sync/event-task-artifact.mjs'
import {syncJobId} from '../sync/job-queue.mjs'
import {exportQuizParentReview,publishQuizParentReview} from '../storage/quiz-parent-review.mjs'
import {publishHelpResponse} from '../sync/help-response.mjs'
const enabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST&&/^demo-/.test(process.env.GCLOUD_PROJECT||''))
describe.skipIf(!enabled)('quiz current-step dialogue security and publication',()=>{
 let client,admin,db,store,uid,revision=0
 const family=`quizhelp${Date.now()}`,token=`quiz${Date.now()}`,link='s'.repeat(43),taskId='q'
 const activity={kind:'choice',label:'Персонаж',instruction:'Выбери одного персонажа.',tokens:[{id:'a',text:'Первый'},{id:'b',text:'Второй'}]}
 const guidance={question:'Кто произнёс приказ?',observation:'Два действия перепутаны.',presentation:{version:1,activity},source:{title:'Текст',edition:'Условное издание',section:'Глава',pages:'1',locator:'Абзац'}}
 let reply,original
 beforeAll(async()=>{
  client=clientApp({apiKey:'fake',projectId:process.env.GCLOUD_PROJECT},family);admin=adminApp({projectId:process.env.GCLOUD_PROJECT},family)
  const auth=getAuth(client);connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true})
  db=getFirestore(client);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(db,host,Number(port))
  store=adminDb(admin);uid=(await signInAnonymously(auth)).user.uid
  const submittedAt=new Date('2026-11-17T09:00:00Z')
  const entries={
   [`deviceSessions/${uid}`]:{linkToken:link},[`accessLinks/${link}`]:{active:true,personId:'p'},
   [`families/${family}`]:{active:true},[`families/${family}/children/c`]:{active:true},[`families/${family}/members/p`]:{active:true,role:'student',childIds:['c']},
   [`assignments/${token}`]:{testId:'test',familyId:family,childId:'c',subject:'Литература',title:'Глава',status:'submitted',submittedAt,questions:[{id:taskId,kind:'single',prompt:'Кто открыл дверь?',points:1}],answers:{q:'a'}},
   [`answerKeys/${token}`]:{entries:{q:{correct:'b',guidance}}}
  }
  await Promise.all(Object.entries(entries).map(([p,v])=>store.doc(p).set(v)))
  const current=quizQuestionReview(taskId,submittedAt,guidance)
  reply={version:1,sourceId:'review',checkedAt:current.checkedAt,correctedAt:current.correctedAt,step:current.correctedAt,intent:'answer',value:JSON.stringify({selected:['a'],groups:{},written:{}})}
  original=(await store.doc(`assignments/${token}`).get()).data()
 })
 afterAll(async()=>{await Promise.all([deleteClientApp(client),deleteAdminApp(admin)])})
 async function send(value=reply,{history=true}={}){
  const event=await createEducationEvent({eventType:'help.requested',familyId:family,childId:'c',source:'firestore',sourceRef:{kind:'help',documentPath:`quizStepReplies/${token}/items/${taskId}`,quizToken:token,taskId},operationId:randomUUID(),actor:{type:'user',uid}},serverTimestamp())
  const data={taskId,revision:++revision,requestKind:'step',requestText:'',reviewReply:value,requestedAt:serverTimestamp(),eventOperationId:event.operationId,eventReceiptId:event.eventId,eventProducerVersion:1}
  const batch=writeBatch(db);batch.set(doc(db,event.sourceRef.documentPath),data);batch.set(doc(db,'educationEvents',event.eventId),event)
  if(history)batch.set(doc(db,`${event.sourceRef.documentPath}/requests/${event.eventId}`),data)
  await batch.commit();return event.eventId
 }
 it('rejects forged step/context, missing atomic history, parent writes and cross-child reads',async()=>{
  for(const forged of [{...reply,step:{...reply.step,question:'Подмена'}},{...reply,correctedAt:{...reply.correctedAt,question:'Подмена'}},{...reply,checkedAt:new Date('2020-01-01')},{...reply,sourceId:`help-${'f'.repeat(64)}`}])await expect(send(forged)).rejects.toMatchObject({code:'permission-denied'})
  await expect(send(reply,{history:false})).rejects.toMatchObject({code:'permission-denied'})
  await store.doc(`families/${family}/members/p`).update({role:'parent'})
  await expect(send()).rejects.toMatchObject({code:'permission-denied'})
  await store.doc(`families/${family}/members/p`).update({role:'student',childIds:['other']})
  await expect(getDoc(doc(db,`quizStepReplies/${token}/items/q/requests/abc`))).rejects.toMatchObject({code:'permission-denied'})
  await store.doc(`families/${family}/members/p`).update({childIds:['c']})
 })
 it('saves an immutable answer, publishes a causal next step in the same queue, and preserves the original grade/attempt',async()=>{
  const id=await send(),event=(await store.doc(`educationEvents/${id}`).get()).data()
  expect((await getDoc(doc(db,`${event.sourceRef.documentPath}/requests/${id}`))).data().reviewReply.value).toBe(reply.value)
  const artifact=await prepareEventTaskArtifact(store,event)
  const input=(await store.doc(artifact.artifactPath).get()).data().inputs
  expect(input.assignment.answers).toEqual({q:'a'});expect(input.answerKey.entries.q.correct).toBe('b');expect(input.reviewStep.question).toBe(reply.step.question)
  const jobPath=`operatorSyncJobs/${syncJobId('triage-help',family,'c',id)}`
  await store.doc(jobPath).set({kind:'triage-help',familyId:family,childId:'c',eventId:id,sourceId:id,status:'queued',artifactPath:artifact.artifactPath,fingerprint:artifact.fingerprint})
  const response={outcome:'partial',message:'Персонаж указан. Теперь раздели приказ и действие.',next:{title:'Раздели действия',question:'Кто выполнил приказ?',presentation:{version:1,activity}}}
  const args={eventId:id,artifactId:artifact.artifactId,reviewResponse:response,decision:{reason:'Сверен собственный микроответ и два разных действия в исходном тексте.',semanticChecked:true,noAnswerChecked:true}}
  expect(await publishHelpResponse(store,args)).toMatchObject({verified:true,unchanged:false})
  expect(await publishHelpResponse(store,args)).toMatchObject({verified:true,unchanged:true})
  const responsePath=`quizStepGuidance/${token}/items/help-${id}`
  expect((await getDoc(doc(db,responsePath))).data().reviewResponse).toEqual(response)
  await expect(setDoc(doc(db,responsePath),{reviewResponse:{outcome:'correct',message:'Подмена',complete:true}})).rejects.toMatchObject({code:'permission-denied'})
  await send({...reply,sourceId:`help-${id}`,step:{question:response.next.question,activity},intent:'stuck',value:JSON.stringify({selected:[],groups:{},written:{}})})
  expect((await store.doc(`assignments/${token}`).get()).data()).toEqual(original)
  const evidence=(await store.doc(jobPath).get()).data().learningEvidencePath
  expect((await store.doc(evidence).get()).data()).toMatchObject({scope:'micro-step',mastery:'not-inferred'})
  await store.doc(`families/${family}/members/p`).update({role:'parent'})
  expect((await getDoc(doc(db,responsePath))).data().reviewResponse).toEqual(response)
  await store.doc(`families/${family}/members/p`).update({role:'student'})
 })
 it('keeps a published full parent guide private from the pupil and other children without changing the attempt',async()=>{
  const exported=await exportQuizParentReview(store,{quizToken:token,questionId:taskId})
  const analysis={version:1,answer:'Проверенный полный ответ родителю по учебному источнику.',difference:'В условной попытке перепутаны разные действия двух персонажей.',method:{name:'Сравнение двух действий',reason:'Сверяем каждое действие с источником.',steps:['Найти поручение','Проверить поступок']},blocks:[{kind:'text',text:'Первая строка источника устанавливает поручение.'},{kind:'text',text:'Вторая строка устанавливает совершённое действие.'}],source:{label:'Условный литературный источник',location:'Глава VI, учебный пример'}}
  const packet={schemaVersion:1,quizToken:token,questionId:taskId,familyId:family,childId:'c',expected:exported.expected,analysis,reason:'Сверены источник и наблюдаемое различие двух действий в условной попытке.',sourceEvidence:['demo:original'],semanticChecked:true,sourceChecked:true,studentSafetyChecked:true}
  expect(await publishQuizParentReview(store,packet,{apply:true})).toMatchObject({verified:true,gradeChanged:false})
  const path=`quizParentReviews/${token}/items/${taskId}`
  await expect(getDoc(doc(db,path))).rejects.toMatchObject({code:'permission-denied'})
  await store.doc(`families/${family}/members/p`).update({role:'parent'})
  expect((await getDoc(doc(db,path))).data().analysis).toEqual(analysis)
  await expect(setDoc(doc(db,path),{analysis:{answer:'Подмена'}})).rejects.toMatchObject({code:'permission-denied'})
  await expect(getDoc(doc(db,`quizParentReviewPrivate/${token}/items/${taskId}`))).rejects.toMatchObject({code:'permission-denied'})
  await store.doc(`families/${family}/members/p`).update({childIds:['other']})
  await expect(getDoc(doc(db,path))).rejects.toMatchObject({code:'permission-denied'})
  await store.doc(`families/${family}/members/p`).update({role:'student',childIds:['c']})
  expect((await store.doc(`assignments/${token}`).get()).data()).toEqual(original)
 })
 it('invalidates changed roots and rejects an already correct question at operator verification',async()=>{
  await store.doc(`answerKeys/${token}`).update({'entries.q.guidance.question':'Другой вопрос?'})
  await expect(send()).rejects.toMatchObject({code:'permission-denied'})
  await store.doc(`answerKeys/${token}`).update({'entries.q.guidance.question':guidance.question})
  const id=await send(),event=(await store.doc(`educationEvents/${id}`).get()).data()
  await store.doc(`assignments/${token}`).update({'answers.q':'b'})
  await expect(prepareEventTaskArtifact(store,event)).rejects.toThrow('task_quiz_reply_not_active')
 })
})
