import { it,expect,vi } from 'vitest'
import { createHash } from 'node:crypto'
import { importOlympiadHistory } from './history-import.mjs'
const bytes=Buffer.from('%PDF-1.4 synthetic historical file'),hash=createHash('sha256').update(bytes).digest('hex')
function fixture(){
 const state=new Map([['families/f/children/c',{active:true}],['families/f/children/c/tasks/existing',{review:'keep'}]])
 const db={doc:path=>({path,get:async()=>({exists:state.has(path),data:()=>state.get(path)}),create:async value=>{if(state.has(path))throw Error('exists');state.set(path,value)}}),collection:()=>({get:async()=>({docs:[{data:()=>({active:true,role:'parent',childIds:['c']})}]})}),runTransaction:async fn=>fn({get:ref=>ref.get(),set:(ref,value)=>state.set(ref.path,value)})}
 const plan={familyId:'f',childId:'c',files:[{id:hash,sha256:hash,size:bytes.length,localPath:'/private/synthetic',name:'work.pdf',contentType:'application/pdf',studentVisible:true}],competitions:[{id:'competition',title:'Пример',aliases:[],seasons:[{id:'2025',label:'2025/26',grade:'5',stages:[{id:'q',label:'Отбор',date:null,score:3,maximum:null,state:'preliminary',award:null,rank:null,notes:[],parentNotes:['closed'],files:[{id:hash,name:'work.pdf',contentType:'application/pdf',size:bytes.length,role:'solution',studentVisible:true}],tasks:[]}]}]}]}
 const disk={putAt:vi.fn(),head:vi.fn(async()=>({size:bytes.length}))}
 return {db,disk,plan,readBytes:async()=>bytes,state}
}
it('plans without writes, applies both role projections and replays without changing existing work',async()=>{
 const f=fixture();expect((await importOlympiadHistory(f)).mode).toBe('plan');expect(f.state.size).toBe(2);expect(f.disk.putAt).not.toHaveBeenCalled()
 expect(await importOlympiadHistory({...f,apply:true})).toMatchObject({verified:true,resultCount:1});const first=JSON.stringify([...f.state]);expect(await importOlympiadHistory({...f,apply:true})).toMatchObject({verified:true});expect(JSON.stringify([...f.state])).toBe(first)
 expect(f.state.get('families/f/children/c/tasks/existing')).toEqual({review:'keep'})
 expect(JSON.stringify(f.state.get('families/f/children/c/olympiadHistory/competition/views/student'))).not.toContain('closed')
})
it('refuses an altered original and never sends it to storage',async()=>{const f=fixture();await expect(importOlympiadHistory({...f,apply:true,readBytes:async()=>Buffer.from('tampered')})).rejects.toThrow('hash_mismatch');expect(f.disk.putAt).not.toHaveBeenCalled()})
it('corrects only the expected revision and preserves the original projections',async()=>{
 const f=fixture();await importOlympiadHistory({...f,apply:true});const path='families/f/children/c/olympiadHistory/competition/views/parent',previous=structuredClone(f.state.get(path));f.plan.competitions[0].seasons[0].stages[0].score=4
 expect((await importOlympiadHistory(f)).conflicts).toEqual([{id:'competition',code:'history_stage_conflict'}])
 await expect(importOlympiadHistory({...f,apply:true})).rejects.toThrow('history_stage_conflict')
 f.plan.expectedDigests={competition:previous.digest};f.plan.correctionReason='Уточнён результат по точному первоисточнику.'
 await importOlympiadHistory({...f,apply:true});expect(f.state.get(path).supersedes).toBe(previous.digest);expect(f.state.get(`families/f/children/c/olympiadHistory/competition/revisions/${previous.digest}-parent`)).toEqual(previous)
 const count=f.state.size;await importOlympiadHistory({...f,apply:true});expect(f.state.size).toBe(count)
})
function recommend(f){const c=f.plan.competitions[0];c.aliases=['current'];f.state.set('families/f/children/c/tasks/next',{familyId:'f',childId:'c',sourceSystem:'family',publication:'active',optional:true,learningContext:{kind:'olympiad',id:'current'}});c.preparation={updatedOn:'2026-10-31',strengths:[{text:'Виден полный счёт.',evidenceIds:['work']}],workingOn:[],next:{taskId:'next',title:'Продолжить задачу',reason:'Уточнить один шаг.',evidenceIds:[]},evidence:[{id:'work',label:'Исходная работа',competitionId:c.id,seasonId:'2025',stageId:'q',file:c.seasons[0].stages[0].files[0]}]};return c}
it('validates source provenance and target family before any upload',async()=>{const f=fixture(),c=recommend(f);c.preparation.evidence[0].competitionId='other';await expect(importOlympiadHistory({...f,apply:true})).rejects.toThrow('history_preparation_source_invalid');expect(f.disk.putAt).not.toHaveBeenCalled();c.preparation.evidence[0].competitionId=c.id;f.state.get('families/f/children/c/tasks/next').childId='other';await expect(importOlympiadHistory({...f,apply:true})).rejects.toThrow('history_next_task_invalid');expect(f.disk.putAt).not.toHaveBeenCalled()})
it('imports the personal route through the existing projections without changing the target task',async()=>{const f=fixture(),c=recommend(f),task=structuredClone(f.state.get('families/f/children/c/tasks/next'));await importOlympiadHistory({...f,apply:true});expect(f.state.get('families/f/children/c/olympiadHistory/competition/views/student').competition.preparation).toEqual(c.preparation);expect(f.state.get('families/f/children/c/tasks/next')).toEqual(task)})
