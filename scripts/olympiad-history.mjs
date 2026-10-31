import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createEducationFirestore } from '../packages/education-runtime/firestore.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { importOlympiadHistory } from '../olympiad/history-import.mjs'
/** Repeatable operator entrypoint; real plans/credentials remain in the private workspace.
 * @see ../docs/modules/assessments/olympiad-history.md */
const [mode,file]=process.argv.slice(2)
if(!['--plan','--apply'].includes(mode)||!file)throw Error('Usage: node scripts/olympiad-history.mjs --plan|--apply PRIVATE_PLAN.json')
const root=process.env.EDUCATION_WORKSPACE_ROOT??process.cwd()
const db=createEducationFirestore({projectId:'education-9d7c6',cwd:root})
try{
 const disk=new YandexDiskStorage(readFileSync(resolve(root,'.local/yandex-disk-token'),'utf8').trim())
 console.log(JSON.stringify(await importOlympiadHistory({db,disk,plan:JSON.parse(readFileSync(file,'utf8')),apply:mode==='--apply'})))
}finally{await db.terminate()}
