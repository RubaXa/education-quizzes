/** @see ../docs/modules/reviews/adaptive-problem-card.md#presentation-gate */
import {readFileSync,realpathSync,statSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import {Timestamp} from '@google-cloud/firestore'
import {operatorFirestore} from './lib/admin-firebase.mjs'
import {editTaskPresentation} from '../storage/task-presentation-edit.mjs'
const args=process.argv.slice(2),[filename,flag]=args
if(!filename||args.length>2||flag&&!['--apply','--dry-run'].includes(flag))throw Error('Использование: task-presentation .local/packet.json [--dry-run|--apply]')
const path=realpathSync(resolve(filename)),privateRoot=realpathSync(resolve('.local'))
if(!path.startsWith(privateRoot+sep)||!path.endsWith('.json')||(statSync(path).mode&0o777)!==0o600)throw Error('Пакет должен находиться в cwd/.local/, иметь расширение .json и права 0600.')
const input=JSON.parse(readFileSync(path,'utf8')),db=operatorFirestore()
try{console.log(JSON.stringify(await editTaskPresentation(db,input,{apply:flag==='--apply',now:Timestamp.now()})))}finally{await db.terminate()}
