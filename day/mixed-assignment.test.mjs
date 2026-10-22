/** @see ../docs/modules/synchronization/plan-generation.md#mixed-actions */
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDaySource } from './build.mjs'
import { assertSourceAligned } from './pipeline-contract.mjs'
import { sourceOnlyPublicationErrors } from './source-only.mjs'
import { mixedEntryActions } from './mixed-assignment.mjs'
import { mergeDayPage } from './merge.mjs'
import { spawnSync } from 'node:child_process'
import { audioLink, boundAssignmentAudio } from '../storage/audio-library.mjs'
const dirs = []
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive:true, force:true })))
const raw = 'упр.4(пис),упр.6(повторить правило) стр.31'
const write = (path, value) => writeFileSync(path, JSON.stringify(value))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mixed-homework-')); dirs.push(dir)
  mkdirSync(join(dir, 'diary'))
  const target = { date:'2026-10-23', complete:true, fetchedAt:'2026-10-22T12:00:00Z', schedule:[{subjectName:'Английский язык'}],
    assignments:[{subjectName:'Английский язык',subjectId:1,sourceItemId:'lesson',detailStatus:'loaded',teacherFiles:[],homeworkEntries:[{id:'123',description:raw}]}] }
  write(join(dir,'diary/snapshot-2026-10-22.json'),{complete:true,assignments:[]})
  write(join(dir,'diary/snapshot-2026-10-23.json'),target)
  return { dir, target, read:()=>JSON.parse(readFileSync(join(dir,'day-source-2026-10-22.json'),'utf8')) }
}
it('turns explicit written and rule repetition into two independent source requests; rebuild preserves each state',()=>{
  const {dir,target,read}=fixture()
  buildDaySource(dir,'2026-10-22')
  const source=read(), tasks=source.subjects[0].tasks
  expect(tasks).toHaveLength(2)
  expect(tasks.map(t=>t.id)).toEqual(['mesh-123-ex4-written','mesh-123-ex6-repeat'])
  expect(tasks.map(t=>t.kind)).toEqual(['written','check'])
  expect(tasks.every(t=>t.materialRequest?.state==='open')).toBe(true)
  expect(tasks[0].materialRequest.question).toContain('4')
  expect(tasks[1].materialRequest.question).toContain('6')
  expect(tasks[1].materialRequest.question).toContain('самопроверку')
  expect(tasks.every(t=>sourceOnlyPublicationErrors(t).length===0)).toBe(true)
  const repeatedPage=mergeDayPage(source,source)
  expect(repeatedPage.subjects[0].tasks.every(t=>sourceOnlyPublicationErrors(t).length===0)).toBe(true)
  expect(()=>assertSourceAligned(source,target)).not.toThrow()
  tasks[0].status='verified'
  tasks[0].instructionStatus={state:'reviewed',message:'Условие сверено отдельно.'}
  tasks[0].sourceOnly=false
  delete tasks[0].assessmentIntent
  tasks[0].materialRequest={...tasks[0].materialRequest,state:'resolved',resolvedTopic:'Письменное упражнение 4',uploadIds:['one']}
  const clarifiedPage=mergeDayPage(repeatedPage,source)
  expect(clarifiedPage.subjects[0].tasks[0].assessmentIntent).toBeUndefined()
  expect(clarifiedPage.subjects[0].tasks[1].assessmentIntent).toEqual({state:'needs-review'})
  write(join(dir,'day-source-2026-10-22.json'),source)
  buildDaySource(dir,'2026-10-22')
  expect(read().subjects[0].tasks[0].status).toBe('verified')
  expect(read().subjects[0].tasks[0].materialRequest.state).toBe('resolved')
  expect(read().subjects[0].tasks[1].materialRequest.state).toBe('open')
})
it('binds repeat audio to its exact split task while written submission and quiz stay independent',()=>{
  const {dir,read}=fixture(); buildDaySource(dir,'2026-10-22')
  const source=read(), [written,repeat]=source.subjects[0].tasks
  const bookId='starlight-english'
  const track=audioLink({id:'starlight-6-6-31',collectionId:'starlight-6',kind:'sb',page:31,exercise:'6a',exerciseType:'exercise',
    title:'Starlight 6 · Учебник · с. 31, упр. 6a',sourceUrl:'https://tankmet.ru/english/starlight-6/6-06 - Ex. 6a p. 31.mp3',
    sha256:'a'.repeat(64),url:'https://disk.yandex.ru/d/starlight-audio'})
  const book={bookId,status:'confirmed',audioLibrary:{collectionId:'starlight-6',tracks:[track]}}
  const pageLinks=Object.fromEntries([written,repeat].map(task=>[task.id,[{sourceType:'textbook-page',sourceRef:`${bookId}#pdf-0033`}]]))
  written.instructionStatus={state:'reviewed',message:'Условие письменного упражнения подтверждено.'}
  repeat.instructionStatus={state:'reviewed',message:'Правило для повторения подтверждено.'}
  written.materialStatus={state:'textbook-page-linked',message:'Страница письменного задания подтверждена.'}
  repeat.materialStatus={state:'textbook-page-linked',message:'Страница правила подтверждена.'}
  written.submission={buttonLabel:'Прикрепить решение',photo:'Сфотографируй решение упражнения 4.'}
  written.materialRequest={...written.materialRequest,state:'resolved',resolvedTopic:'Письменное упражнение 4'}
  repeat.materialRequest={...repeat.materialRequest,state:'resolved',resolvedTopic:'Правило к упражнению 6'}
  repeat.assessmentIntent={state:'confirmed',mode:'ordinary',topic:'Правило к упражнению 6',evidenceRef:'Уточнение по фотографиям.'}
  repeat.testToken='repeat-test-token'
  const audio=boundAssignmentAudio(source,[book],pageLinks)
  expect(Object.keys(audio)).toEqual([repeat.id])
  expect(audio[repeat.id]).toEqual([track])
  expect(written).toMatchObject({kind:'written',submission:{buttonLabel:'Прикрепить решение'},materialRequest:{state:'resolved'}})
  expect(written.testToken).toBeUndefined()
  expect(repeat).toMatchObject({kind:'check',testToken:'repeat-test-token',assessmentIntent:{state:'confirmed'},materialRequest:{state:'resolved'}})
  expect(repeat.submission).toBeUndefined()
  const page=mergeDayPage(null,{...source,audioProjectionVersion:1,
    materialLinks:{[written.id]:[],[repeat.id]:audio[repeat.id]},
    testPlacements:[{taskId:repeat.id,subjectId:source.subjects[0].id,token:repeat.testToken}]})
  expect(page.materialLinks[written.id]).toEqual([])
  expect(page.materialLinks[repeat.id].map(link=>link.sourceRef)).toEqual(['audio:starlight-6-6-31'])
  expect(page.testPlacements).toEqual([{taskId:repeat.id,subjectId:source.subjects[0].id,token:repeat.testToken}])
})
it('rejects a missing split action even when the full raw entry is retained',()=>{
  const {dir,target,read}=fixture(); buildDaySource(dir,'2026-10-22')
  const source=read(); source.subjects[0].tasks.pop()
  expect(()=>assertSourceAligned(source,target)).toThrow()
})
it('rejects moving both actions and their alias into a different subject',()=>{
  const {dir,target,read}=fixture(); buildDaySource(dir,'2026-10-22')
  const source=read(); source.subjects[0].id='history'; source.subjects[0].name='История'; source.sourceOnlyEntries[0].subjectId='history'
  expect(()=>assertSourceAligned(source,target)).toThrow(/предмете/)
})
it('passes the actual publication CLI with both split actions and rejects an omitted action',()=>{
  const {dir,read}=fixture(); buildDaySource(dir,'2026-10-22')
  const run=()=>spawnSync(process.execPath,['scripts/day.mjs','validate','2026-10-22'],{encoding:'utf8',env:{...process.env,EDUCATION_CHILD_WORKSPACE:dir}})
  const result=run()
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  const source=read(); source.subjects[0].tasks.pop(); write(join(dir,'day-source-2026-10-22.json'),source)
  expect(run().status).not.toBe(0)
})
it('retires only an untouched combined card and preserves full original attribution on publication merge',()=>{
  const {dir,read}=fixture()
  const prior={targetDate:'2026-10-23',subjects:[{id:'english',name:'Английский язык',tasks:[{id:'mesh-123',title:raw,meshText:raw,kind:'written',status:'unknown'}]}]}
  write(join(dir,'day-source-2026-10-22.json'),prior)
  buildDaySource(dir,'2026-10-22')
  const source=read(), merged=mergeDayPage(prior,source)
  expect(merged.subjects[0].tasks.map(task=>task.id)).toEqual(['mesh-123-ex4-written','mesh-123-ex6-repeat'])
  expect(source.subjects[0].mesh).toBe(raw)
  expect(source.sourceOnlyEntries[0].rawText).toBe(raw)
  expect(source.subjects[0].tasks[0].source).toContain('запись 123.')
  prior.subjects[0].tasks[0].status='partial'
  write(join(dir,'day-source-2026-10-22.json'),prior)
  expect(()=>buildDaySource(dir,'2026-10-22')).toThrow(/истории/)
})
it('fails closed on a forged part or changed source after splitting',()=>{
  const {dir,target,read}=fixture(); buildDaySource(dir,'2026-10-22')
  const source=read(); source.subjects[0].tasks[0].meshText='упр.99(пис) стр.31'
  expect(()=>assertSourceAligned(source,target)).toThrow(/Разделение/)
  target.assignments[0].homeworkEntries[0].description=raw.replace('стр.31','стр.32')
  write(join(dir,'diary/snapshot-2026-10-23.json'),target)
  expect(()=>buildDaySource(dir,'2026-10-22')).toThrow(/свидетельства/)
})
it('does not guess actions from comma lists, unknown annotations or extra instructions',()=>{
  for(const description of ['упр.2,3(пис)','упр.2 и 3(пис)',raw+' и выучить слова',raw.replace('повторить правило','устно'),raw.replace('упр.6','упр.4')]) {
    expect(mixedEntryActions({id:'1',description})).toHaveLength(1)
  }
})
it('an open source request never permits a topic, result instructions or a test in raw mode',()=>{
  const {dir,read}=fixture(); buildDaySource(dir,'2026-10-22')
  const task=read().subjects[0].tasks[1]
  for(const patch of [{testToken:'private-test'},{assessmentIntent:{state:'confirmed',topic:'Guess'}},{assessmentIntent:{state:'needs-review',topic:'Guess'}},{materialRequest:{...task.materialRequest,state:'resolved'}}]) {
    expect(sourceOnlyPublicationErrors({...task,...patch}).length).toBeGreaterThan(0)
  }
})
