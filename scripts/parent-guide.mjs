/** @see ../docs/modules/reviews/method-guided-solutions.md */
import {readFileSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import {isDeepStrictEqual} from 'node:util'
import {Timestamp} from '@google-cloud/firestore'
import {operatorFirestore} from './lib/admin-firebase.mjs'
import {parentGuideEditErrors} from '../storage/parent-guide-edit.mjs'
const [filename,flag]=process.argv.slice(2),path=resolve(filename??'')
if(!path.startsWith(resolve('.local')+sep)||!path.endsWith('.json')||flag&&!['--apply','--dry-run'].includes(flag))throw new Error('Использование: parent-guide .local/edit.json [--dry-run|--apply]')
const input=JSON.parse(readFileSync(path,'utf8'))
if(!/^[A-Za-z0-9_-]+$/.test(input.pageId??'')||!/^[a-z0-9-]+$/.test(input.taskId??''))throw new Error('Нужны точные pageId и taskId.')
const db=operatorFirestore()
try{
 const ref=db.doc(`dayTaskGuides/${input.pageId}/items/${input.taskId}`),ownerRef=db.doc(`dayOwners/${input.pageId}`),pageRef=db.doc(`dayPages/${input.pageId}`)
 const [before,owner,page]=await db.getAll(ref,ownerRef,pageRef)
 const task=page.data()?.subjects?.flatMap(s=>s.tasks??[]).find(t=>t.id===input.taskId)
 if(page.data()?.kind!=='student'||!task||!owner.data()?.familyId||owner.data().familyId!==page.data().familyId||owner.data().childId!==page.data().childId)throw new Error('Владелец, задание и ресурс не совпадают.')
 const errors=parentGuideEditErrors(before.data(),input);if(errors.length)throw new Error(errors.join('\n'))
 if(flag!=='--apply'){console.log(JSON.stringify({valid:true,applied:false,revision:input.guide.revision}));}
 else{
  await db.runTransaction(async tx=>{
   const [fresh,o,p]=await tx.getAll(ref,ownerRef,pageRef)
   if(!fresh.updateTime.isEqual(before.updateTime)||!o.updateTime.isEqual(owner.updateTime)||!p.updateTime.isEqual(page.updateTime))throw new Error('Данные изменились после проверки; коррекция остановлена.')
   const prior=fresh.data(),now=Timestamp.now()
   tx.update(ref,{guide:input.guide,updatedAt:now,guideEdits:[...(prior.guideEdits??[]),{at:now,reason:input.reason,guide:prior.guide}].slice(-10)})
  })
  const after=(await ref.get()).data()
  if(!isDeepStrictEqual(after.guide,input.guide))throw new Error('Родительский путь после записи не совпал.')
  for(const [key,value] of Object.entries(before.data()))if(!['guide','updatedAt','guideEdits'].includes(key)&&!isDeepStrictEqual(after[key],value))throw new Error('Изменены поля за пределами guide.')
  console.log(JSON.stringify({applied:true,verified:true,revision:after.guide.revision,stageIdsPreserved:true,sourceRevisionPreserved:true}))
 }
}finally{await db.terminate()}
