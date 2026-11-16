/** @see ../docs/modules/reviews/criteria-and-knowledge.md#current-task-audit */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,dirname,sep} from 'node:path'
import {operatorFirestore} from './lib/admin-firebase.mjs'
import {captureCurrentTaskAudit} from '../sync/task-audit.mjs'
const [date,file]=process.argv.slice(2),path=resolve(file??'')
if(!file||!path.startsWith(resolve('.local')+sep)||!file.endsWith('.json'))throw Error('Использование: task-audit YYYY-MM-DD .local/private-bundle.json')
const read=name=>JSON.parse(readFileSync(resolve('.local',name),'utf8'))
const owner=read('family-access.json').legacyDayOwner
const pairs=Object.entries(read('day-links.json')).map(([sourceDate,pair])=>({sourceDate,...pair}))
const db=operatorFirestore()
try{
 const bundle=await captureCurrentTaskAudit(db,{pairs,owner,viewDate:date})
 mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,JSON.stringify(bundle,null,2),{mode:0o600})
 console.log(JSON.stringify({exported:true,readOnly:true,pages:bundle.pages.length,tasks:bundle.pages.reduce((n,p)=>n+p.currentTaskIds.length,0),quizzes:bundle.quizzes.length,path}))
}finally{await db.terminate()}
