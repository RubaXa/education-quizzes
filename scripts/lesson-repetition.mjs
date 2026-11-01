/** @see ../docs/decisions/lesson-repetition-2026-11-01.md */
/** @see ../docs/modules/assessments/lesson-repetition.md */
import {readFileSync} from 'node:fs'
import {planLessonRepetition} from '../assessment/lesson-repetition.mjs'
try {
  const [command,path]=process.argv.slice(2)
  if(command!=='plan'||!path)throw new Error('Usage: node scripts/lesson-repetition.mjs plan PRIVATE_EVIDENCE.json')
  console.log(JSON.stringify(planLessonRepetition(JSON.parse(readFileSync(path,'utf8'))),null,2))
} catch(error){console.error(error.message);process.exitCode=1}
