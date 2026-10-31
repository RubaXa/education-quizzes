import { readFileSync } from 'node:fs'
import { createEducationFirestore } from '../packages/education-runtime/firestore.mjs'
import { refreshOlympiadPreparation } from '../olympiad/preparation-store.mjs'
/** Repeatable configure/backfill through the shared operator runtime.
 * @see ../docs/modules/assessments/olympiad-history.md#обновление-после-проверки */
const [mode,file]=process.argv.slice(2)
if(!['--plan','--apply'].includes(mode)||!file)throw Error('Usage: node scripts/olympiad-preparation.mjs --plan|--apply PRIVATE_PLAN.json')
const plan=JSON.parse(readFileSync(file,'utf8'))
const db=createEducationFirestore({projectId:'education-9d7c6',cwd:process.env.EDUCATION_WORKSPACE_ROOT??process.cwd()})
try{console.log(JSON.stringify(await refreshOlympiadPreparation({db,...plan,apply:mode==='--apply'})))}finally{await db.terminate()}
