/** @see ../../docs/decisions/quiz-review-dialogue-2026-11-17.md */
/** Addressed quiz micro-dialogue; shared event protocol, no grading on the client.
 * @see ../../docs/shared/design/student-review-step.md#quiz-dialogue */
import {collection,doc,getDocFromServer,limit,onSnapshot,query,runTransaction,serverTimestamp,where} from 'firebase/firestore'
import {getAuth} from 'firebase/auth'
import {db} from './firebase'
import {prepareEducationEvent,stagePreparedEducationEventInTransaction} from './educationEventProducer'
import {quizQuestionReview} from '../../packages/education-presentation/quiz-review-reply.mjs'
import {resolveReviewReplyStep,reviewReplyErrors,sameReviewValue,type ReviewReply} from '../../packages/education-presentation/review-reply.mjs'
import type {DayHelp} from './dayStore'
import type {DayGuidance} from './dayGuidance'

export function watchQuizReplyHistory(token:string,questionId:string,change:(items:DayHelp[])=>void,error:()=>void){
 return onSnapshot(query(collection(db,'quizStepReplies',token,'items',questionId,'requests'),limit(100)),snapshot=>{
  if(snapshot.size>=100){error();return}change(snapshot.docs.map(d=>({id:d.id,...d.data()} as DayHelp)))
 },error)
}
export function watchQuizStepGuidance(token:string,questionId:string,change:(items:DayGuidance[])=>void,error:()=>void){
 return onSnapshot(query(collection(db,'quizStepGuidance',token,'items'),where('taskId','==',questionId),limit(100)),snapshot=>{
  if(snapshot.size>=100){error();return}change(snapshot.docs.map(d=>({id:d.id,...d.data()} as DayGuidance)))
 },error)
}
export async function sendQuizReviewReply(token:string,questionId:string,reply:ReviewReply,note:string,operationId:string){
 if(reviewReplyErrors(reply).length||note.length>800)throw Error('Некорректный ответ на шаг.')
 const assignmentRef=doc(db,'assignments',token),keyRef=doc(db,'answerKeys',token)
 const owner=await getDocFromServer(assignmentRef),uid=getAuth().currentUser?.uid
 const {familyId,childId}=owner.data()??{}
 if(!owner.exists()||!uid||!familyId||!childId)throw Error('Сначала открой личную ссылку Education.')
 const envelope=await prepareEducationEvent({eventType:'help.requested',familyId,childId,source:'firestore',sourceRef:{kind:'help',documentPath:`quizStepReplies/${token}/items/${questionId}`,quizToken:token,taskId:questionId},operationId,actor:{type:'user',uid}})
 const currentRef=doc(db,'quizStepReplies',token,'items',questionId),historyRef=doc(currentRef,'requests',envelope.eventId)
 await runTransaction(db,async transaction=>{
  const [assignment,key,current,saved]=await Promise.all([transaction.get(assignmentRef),transaction.get(keyRef),transaction.get(currentRef),transaction.get(historyRef)])
  if(saved.exists()){
   if(saved.data().eventOperationId===operationId&&sameReviewValue(saved.data().reviewReply,reply)&&saved.data().requestText===note.trim())return
   throw Error('Этот ответ уже сохранён с другими данными.')
  }
  const data=assignment.data(),guidance=reply.sourceId==='review'?undefined:await transaction.get(doc(db,'quizStepGuidance',token,'items',reply.sourceId))
  if(data?.status!=='submitted'||data.familyId!==familyId||data.childId!==childId||!data.questions?.some((q:{id:string})=>q.id===questionId))throw Error('Тест изменился. Открой свежий результат.')
  resolveReviewReplyStep(reply,quizQuestionReview(questionId,data.submittedAt,key.data()?.entries?.[questionId]?.guidance),guidance?.exists()?{id:guidance.id,...guidance.data()}:undefined)
  const request={taskId:questionId,revision:(current.data()?.revision??0)+1,requestKind:'step',requestText:note.trim(),reviewReply:reply,requestedAt:serverTimestamp(),eventOperationId:operationId,eventReceiptId:envelope.eventId,eventProducerVersion:1}
  transaction.set(currentRef,request);transaction.set(historyRef,request);stagePreparedEducationEventInTransaction(transaction,envelope)
 })
 const saved=await getDocFromServer(historyRef)
 if(!saved.exists()||saved.data().eventReceiptId!==envelope.eventId||!sameReviewValue(saved.data().reviewReply,reply))throw Error('Не удалось подтвердить сохранение ответа.')
 return envelope.eventId
}
