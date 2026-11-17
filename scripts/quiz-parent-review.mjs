/** @see ../docs/services/operator-cli/README.md */
/** @see ../docs/modules/reviews/parent-review.md */
/** @see ../docs/decisions/parent-review-pilot-2026-11-17.md */
import {readFileSync,writeFileSync,realpathSync,statSync,mkdirSync} from 'node:fs'
import {resolve,dirname,sep} from 'node:path'
import {Timestamp} from '@google-cloud/firestore'
import {operatorFirestore} from './lib/admin-firebase.mjs'
import {exportQuizParentReview,publishQuizParentReview} from '../storage/quiz-parent-review.mjs'
const args=process.argv.slice(2),[command,first,second,third]=args
function privatePath(name,exists=false){const path=resolve(name??''),root=realpathSync('.local');if(!path.startsWith(root+sep)||!path.endsWith('.json'))throw Error('Нужен JSON в закрытой .local/.');if(exists&&(realpathSync(path)!==path||(statSync(path).mode&0o777)!==0o600))throw Error('Нужен обычный файл0600.');return path}
if(!['export','publish'].includes(command)||command==='export'&&args.length!==4||command==='publish'&&(args.length<2||args.length>3||second&&second!=='--apply'))throw Error('quiz-parent-review export TOKEN QUESTION .local/export.json | publish .local/packet.json [--apply]')
const db=operatorFirestore()
try{
 if(command==='export'){const path=privatePath(third);mkdirSync(dirname(path),{recursive:true,mode:0o700});const data=await exportQuizParentReview(db,{quizToken:first,questionId:second});writeFileSync(path,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({exported:true,questionId:second,privateOnly:true,path}))}
 else console.log(JSON.stringify(await publishQuizParentReview(db,JSON.parse(readFileSync(privatePath(first,true),'utf8')),{apply:second==='--apply',now:Timestamp.now()})))
}finally{await db.terminate()}
