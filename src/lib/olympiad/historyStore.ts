import { getAuth } from 'firebase/auth'
import { doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { currentEducationPersonId } from '../personalAccess'
import { prepareEducationEvent, stagePreparedEducationEvent } from '../educationEventProducer'
import type { HistoryCompetition, HistoryIndexEntry } from './historyTypes'
/** Addressed family projections; no collection scans or closed keys in a learner response.
 * @see ../../../docs/modules/assessments/olympiad-history.md */
const segment=(s:string)=>{if(!/^[A-Za-z0-9_-]{1,120}$/.test(s))throw Error('Некорректный адрес истории.');return s}
const root=(familyId:string,childId:string)=>`families/${segment(familyId)}/children/${segment(childId)}`
export function watchOlympiadHistoryIndex(familyId:string,childId:string,onChange:(value:HistoryIndexEntry[])=>void,onError:(error:Error)=>void){
 return onSnapshot(doc(db,`${root(familyId,childId)}/learningHistory/olympiads`),snapshot=>{
  const value=snapshot.data(),entries:HistoryIndexEntry[]=[]
  if(value?.familyId===familyId&&value?.childId===childId&&value.schemaVersion===1&&Array.isArray(value.entries))for(const entry of value.entries){
   if(typeof entry?.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(entry.id)||typeof entry.title!=='string'||typeof entry.summary!=='string'||!Array.isArray(entry.aliases)||entry.aliases.some((v:unknown)=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(v))||!Number.isSafeInteger(entry.resultCount)||entry.resultCount<0||!Number.isSafeInteger(entry.seasonCount)||entry.seasonCount<0)continue
   entries.push({id:entry.id,title:entry.title,summary:entry.summary,aliases:entry.aliases,resultCount:entry.resultCount,seasonCount:entry.seasonCount})
  }
  onChange(entries)
 },onError)
}
export function watchOlympiadHistory(familyId:string,childId:string,id:string,parent:boolean,onChange:(value:HistoryCompetition|null)=>void,onError:(error:Error)=>void){
 return onSnapshot(doc(db,`${root(familyId,childId)}/olympiadHistory/${segment(id)}/views/${parent?'parent':'student'}`),snapshot=>{
  const value=snapshot.data();onChange(value?.schemaVersion===1&&value?.familyId===familyId&&value?.childId===childId&&value.competition?.id===id?value.competition:null)
 },onError)
}
/** The existing queue broker authorizes each original; no shared/public URL is persisted in history. */
export async function requestHistoryFile(familyId:string,childId:string,fileId:string):Promise<string>{
 const uid=getAuth().currentUser?.uid,personId=currentEducationPersonId()
 if(!uid||!personId||!/^[a-f0-9]{64}$/.test(fileId))throw Error('Для просмотра работы нужен вход в Education.')
 const id=crypto.randomUUID(),path=`${root(familyId,childId)}/mediaRequests/${id}`
 const event=await prepareEducationEvent({eventType:'material.read_requested',familyId,childId,source:'firestore',sourceRef:{kind:'material',documentPath:path,recordId:id},operationId:`media-read:${id}`,actor:{type:'user',uid}})
 const batch=writeBatch(db);batch.set(doc(db,path),{fileId,personId,deviceUid:uid,status:'requested',createdAt:serverTimestamp(),eventProducerVersion:1,eventReceiptId:event.eventId,eventOperationId:event.operationId});stagePreparedEducationEvent(batch,event);await batch.commit()
 return new Promise((resolve,reject)=>{
  let stop=()=>{};const timer=window.setTimeout(()=>{stop();reject(Error('Файл пока не удалось открыть. Повторите запрос.'))},120000)
  const fail=(error:Error)=>{window.clearTimeout(timer);stop();reject(error)}
  stop=onSnapshot(doc(db,path),snapshot=>{
   const value=snapshot.data();if(value?.status==='failed')return fail(Error('Доступ к файлу недоступен. Обновите страницу.'))
   if(value?.status!=='ready')return
   try{const url=new URL(value.href);if(url.protocol!=='https:'||!/(^|\.)(yandex\.(net|ru)|yandexcloud\.net)$/.test(url.hostname)||!Number.isFinite(value.expiresAt?.toMillis?.())||value.expiresAt.toMillis()<=Date.now())throw Error('Некорректный адрес работы.');window.clearTimeout(timer);stop();resolve(url.href)}catch{fail(Error('Не удалось получить адрес работы.'))}
  },fail)
 })
}
