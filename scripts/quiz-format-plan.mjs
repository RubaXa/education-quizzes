/** @see ../docs/decisions/assessment-format-gates-2026-11-17.md */
/** @see ../docs/modules/assessments/format-plan.md */
import {readFileSync,writeFileSync,chmodSync} from 'node:fs'
import {resolve} from 'node:path'
import {buildFormatPlan,validateFormatPlan} from '../assessment/format-plan.mjs'

try{
 const [command,first,second]=process.argv.slice(2)
 if(command==='check'){
  if(!first||!second)throw Error('quiz:plan check PLAN.json QUIZ.json')
  const plan=JSON.parse(readFileSync(first,'utf8')),spec=JSON.parse(readFileSync(second,'utf8'))
  const errors=validateFormatPlan(plan,spec)
  if(errors.length)throw Error(errors.join('\n'))
  console.log(JSON.stringify({valid:true,questions:spec.questions.length}))
 }else{
  if(!command||!first||second)throw Error('quiz:plan INPUT.json OUTPUT.json | check PLAN.json QUIZ.json')
  if(resolve(command)===resolve(first))throw Error('Вход и выход должны быть разными файлами.')
  const input=JSON.parse(readFileSync(command,'utf8')),blueprint=buildFormatPlan(input)
  writeFileSync(first,`${JSON.stringify({input,blueprint},null,2)}\n`,{mode:0o600,flag:'wx'})
  chmodSync(first,0o600)
  console.log(JSON.stringify({created:true,profile:blueprint.profile,counts:blueprint.counts}))
 }
}catch(error){console.error(error.message);process.exitCode=1}
