/** @see ../docs/modules/assessments/format-plan.md */
import {expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {mkdtempSync,writeFileSync,statSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {buildFormatPlan,validateFormatPlan,assertFormatHistory} from './format-plan.mjs'

const input=(n=8)=>({version:1,subjectAdapter:'history',purpose:'mixed-practice',questionIds:Array.from({length:n},(_,i)=>`q${i+1}`),history:null,historyGapReason:'Проверенная предшествующая попытка неизвестна.'})
const packet=(source=input())=>({input:source,blueprint:buildFormatPlan(source)})
const specFor=p=>({questions:p.blueprint.slots.map(s=>({id:s.questionId,kind:s.recommendedKind,...(s.group==='selection'?{options:[{id:'a',label:'Первый'},{id:'b',label:'Второй'}],answer:{correct:'a'}}:{})}))})
const history={schemaVersion:1,attempts:[{testId:'prior',earned:5,possible:10}],next:{historyFingerprint:'a'.repeat(64),targetCount:8}}

it('rejects the actual all-typing regressions, including short plus long',()=>{
 for(const kinds of [[...Array(9).fill('short'),...Array(2).fill('long')],[...Array(4).fill('short'),...Array(4).fill('long')]]){
  const p=packet(input(kinds.length)),spec={questions:kinds.map((kind,i)=>({id:`q${i+1}`,kind}))}
  expect(validateFormatPlan({formatPlan:p},spec)).not.toEqual([])
 }
})
it('computes a repeatable mixed plan and accepts the corresponding existing component variants',()=>{
 const p=packet()
 expect(buildFormatPlan(input())).toEqual(p.blueprint)
 expect(p.blueprint.counts).toEqual({selection:4,production:3,explanation:1})
 expect(validateFormatPlan({formatPlan:p},specFor(p))).toEqual([])
 const renderer=readFileSync(new URL('../src/components/QuizQuestionCard.tsx',import.meta.url),'utf8')
 for(const kind of ['single','multiple','short','number','long','figure'])expect(renderer).toContain(`'${kind}'`)
})
it('uses confirmed low performance for support, keeps unknown separate and retains independent production',()=>{
 const p=packet({...input(),history,historyGapReason:undefined})
 expect(p.blueprint.profile).toBe('supported')
 expect(p.blueprint.counts).toEqual({selection:6,production:1,explanation:1})
 expect(packet().blueprint.profile).toBe('mixed')
 expect(()=>buildFormatPlan({...input(),historyGapReason:''})).toThrow()
 expect(()=>buildFormatPlan({...input(),history:{...history,attempts:[{earned:-1,possible:10}]}})).toThrow()
 expect(()=>assertFormatHistory({formatPlan:p}, {...history,next:{...history.next,historyFingerprint:'b'.repeat(64)}})).toThrow()
 expect(()=>assertFormatHistory({formatPlan:p},history)).not.toThrow()
})
it('cannot omit or tamper with the blueprint, IDs or kinds',()=>{
 const p=packet(),spec=specFor(p)
 expect(validateFormatPlan({},spec)).not.toEqual([])
 p.blueprint.counts.selection=0
 expect(validateFormatPlan({formatPlan:p},spec)).not.toEqual([])
 const fresh=packet();spec.questions.reverse()
 expect(validateFormatPlan({formatPlan:fresh},spec)).not.toEqual([])
 expect(()=>buildFormatPlan({...input(),questionIds:['q','q']})).toThrow()
 const invalid=specFor(fresh);invalid.questions[0].answer.correct='missing'
 expect(validateFormatPlan({formatPlan:fresh},invalid)).not.toEqual([])
 invalid.questions[0].options[1].id='a'
 expect(validateFormatPlan({formatPlan:fresh},invalid)).not.toEqual([])
})
it('keeps source-bound dictation as an explicit exception and rejects a fabricated exception',()=>{
 const p=packet({...input(1),purpose:'vocabulary-dictation'})
 expect(p.blueprint.slots[0].recommendedKind).toBe('short')
 expect(validateFormatPlan({formatPlan:p},specFor(p))).not.toEqual([])
 expect(validateFormatPlan({formatPlan:p,dictation:{sourceRef:'book'}},specFor(p))).toEqual([])
 expect(()=>buildFormatPlan(input(1))).toThrow()
})
it('runs offline, protects private output and returns nonzero for an invalid authored quiz',()=>{
 const dir=mkdtempSync(join(tmpdir(),'education-format-'))
 const source=join(dir,'input.json'),output=join(dir,'blueprint.json'),planPath=join(dir,'plan.json'),quizPath=join(dir,'quiz.json')
 const run=(...args)=>spawnSync(process.execPath,['scripts/quiz-format-plan.mjs',...args],{encoding:'utf8',env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:'/no/credentials'}})
 try{
  writeFileSync(source,JSON.stringify(input()))
  expect(run(source,output).status).toBe(0)
  expect(statSync(output).mode&0o777).toBe(0o600)
  expect(run(source,output).status).not.toBe(0)
  const p=JSON.parse(readFileSync(output,'utf8')),spec=specFor(p)
  writeFileSync(planPath,JSON.stringify({formatPlan:p}));writeFileSync(quizPath,JSON.stringify(spec))
  expect(run('check',planPath,quizPath).status).toBe(0)
  spec.questions[0].kind='short';writeFileSync(quizPath,JSON.stringify(spec))
  expect(run('check',planPath,quizPath).status).not.toBe(0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
