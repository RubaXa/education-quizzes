/** @see ../docs/shared/design/student-review-step.md#addressed-presentation-migration */
/** @see ../docs/decisions/review-presentation-migration-2026-11-17.md */
import {readFileSync,writeFileSync,realpathSync,statSync,mkdirSync} from 'node:fs'
import {resolve,dirname,sep} from 'node:path'
import {Timestamp} from '@google-cloud/firestore'
import {operatorFirestore} from './lib/admin-firebase.mjs'
import {exportReviewPresentation,editReviewPresentation,editReviewSheet} from '../storage/review-presentation-edit.mjs'
const args=process.argv.slice(2),[command,first,second,third]=args
function privatePath(filename,existing=false){const path=resolve(filename??''),root=realpathSync(resolve('.local'));if(!path.startsWith(root+sep)||!path.endsWith('.json'))throw Error('Нужен закрытый JSON в cwd/.local/.');if(existing&&(realpathSync(path)!==path||(statSync(path).mode&0o777)!==0o600))throw Error('Нужен обычный JSON с правами0600.');return path}
if(!['export','edit','sheet'].includes(command)||command==='export'&&(args.length!==4||!first||!second||!third)||['edit','sheet'].includes(command)&&(args.length<2||args.length>3||second&&second!=='--apply'))throw Error('review:presentation export DAY TASK .local/export.json | edit|sheet .local/packet.json [--apply]')
const db=operatorFirestore()
try{
 if(command==='export'){const path=privatePath(third);mkdirSync(dirname(path),{recursive:true,mode:0o700});const result=await exportReviewPresentation(db,{studentToken:first,taskId:second});writeFileSync(path,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({exported:true,taskId:second,path}))}
 else console.log(JSON.stringify(await (command==='sheet'?editReviewSheet:editReviewPresentation)(db,JSON.parse(readFileSync(privatePath(first,true),'utf8')),{apply:second==='--apply',now:Timestamp.now()})))
}finally{await db.terminate()}
