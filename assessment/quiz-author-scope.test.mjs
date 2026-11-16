import {it,expect} from 'vitest'
import {pendingManualQuestionIds} from './decision-graph.mjs'
import {exportAuthorScope,correctAuthorScope} from './quiz-author-scope.mjs'
const clone=v=>structuredClone(v)
class Stamp{constructor(n){this.n=n}isEqual(s){return this.n===s?.n}}
function fixture(){
 const token='synthetic-quiz',owner={familyId:'synthetic-family',childId:'synthetic-child'},questions=[{id:'assigned',kind:'short',prompt:'В назначенной главе',points:2},{id:'outside',kind:'long',prompt:'Посторонняя глава',points:3,topic:'Текстовая деталь'}]
 const rows=new Map([['assignments/'+token,{...owner,schemaVersion:1,testId:'synthetic-test',title:'Чтение',subject:'Литература',questions,status:'submitted',answers:{assigned:'да',outside:'Собственный ответ'},startedAt:'started',submittedAt:'submitted',updatedAt:'saved'}],['answerKeys/'+token,{entries:{assigned:{correct:'да'},outside:{correct:'Закрытый ключ'}}}],['reviews/'+token,{entries:{outside:{points:0,explanation:'Прежний разбор'}}}],['quizReviewPrivate/'+token,{...owner,rubrics:{outside:[{id:'criterion',skillId:'literature-detail',skillLabel:'Текстовая деталь',maxPoints:3}]},other:'preserve'}],['dashboard/learner/assignments/'+token,{testId:'synthetic-test',previewToken:'synthetic-preview',other:'student'}],['dashboard/parent/assignments/'+token,{testId:'synthetic-test',previewToken:'synthetic-preview',other:'parent'}],['previews/synthetic-preview',{testId:'synthetic-test',questions,title:'Чтение'}],['dayOwners/source-day',{...owner,date:'2026-11-01'}],['dayPages/source-day',{...owner,kind:'student',date:'2026-11-01',subjects:[{tasks:[{id:'mesh-source',meshText:'Прочитать главы 1–3.',testToken:token}]}]}],['families/synthetic-family/children/synthetic-child/skills/literature-detail',{skillId:'literature-detail',mastery:'previous-independent-state',lastOutcome:'confirmed',evidenceIds:['old-evidence']}]])
 rows.set('dashboard/learner',{...owner,kind:'student'});rows.set('dashboard/parent',{...owner,kind:'parent'})
 const versions=new Map([...rows.keys()].map(k=>[k,1]));let writes=0,beforeTx=null,afterTx=null;const reads=[]
 const snapshot=path=>({id:path.split('/').at(-1),ref:{path},exists:rows.has(path),updateTime:new Stamp(versions.get(path)??0),data:()=>clone(rows.get(path))})
 const db={doc:path=>({path}),getAll:async(...refs)=>{reads.push(refs.map(r=>r.path));return refs.map(r=>snapshot(r.path))},runTransaction:async fn=>{beforeTx?.();const pending=[];const writer={getAll:async(...refs)=>refs.map(r=>snapshot(r.path)),update(ref,value,precondition){pending.push(()=>{if(!rows.has(ref.path)||precondition&&!snapshot(ref.path).updateTime.isEqual(precondition.lastUpdateTime))throw Error('precondition');rows.set(ref.path,{...rows.get(ref.path),...clone(value)});versions.set(ref.path,(versions.get(ref.path)??0)+1);writes++})},create(ref,value){pending.push(()=>{if(rows.has(ref.path))throw Error('already-exists');rows.set(ref.path,clone(value));versions.set(ref.path,1);writes++})}};await fn(writer);for(const save of pending)save();afterTx?.()}}
 const context={learnerToken:token,owner,source:{pageId:'source-day',taskId:'mesh-source'},indexPaths:['dashboard/learner/assignments/'+token,'dashboard/parent/assignments/'+token]}
 const request=async()=>({...await exportAuthorScope(db,context),reason:'Автор ошибочно включил вопрос из другой главы.',exclusions:[{questionId:'outside',questionPrompt:'Посторонняя глава',scopeQuote:'главы 1–3',explanation:'Содержание этого вопроса находится в другой, не назначенной главе.',evidenceRefs:['synthetic-book:chapter-8']}]})
 return {db,rows,versions,context,request,reads,get writes(){return writes},before:fn=>{beforeTx=fn},after:fn=>{afterTx=fn},mutate:(path,fn)=>{rows.set(path,fn(clone(rows.get(path))));versions.set(path,(versions.get(path)??0)+1)}}
}
it('dry-runs without writes, then atomically excludes without altering question, answer, key or old review',async()=>{
 const f=fixture(),r=await f.request(),before=new Map([...f.rows].map(([k,v])=>[k,clone(v)]))
 expect(await correctAuthorScope(f.db,r)).toMatchObject({valid:true,applied:false,after:{earned:2,possible:2,pending:0,excluded:1}});expect(f.writes).toBe(0)
 const receipt=await correctAuthorScope(f.db,r,{apply:true,now:'synthetic-time'});expect(receipt).toMatchObject({verified:true,after:{earned:2,possible:2}})
 for(const path of ['assignments/synthetic-quiz','previews/synthetic-preview',...f.context.indexPaths])expect(f.rows.get(path).authorScopeExclusions).toEqual({version:1,revision:1,questionIds:['outside']})
 expect(pendingManualQuestionIds(f.rows.get('assignments/synthetic-quiz'),{})).toEqual([])
 expect(f.rows.get('assignments/synthetic-quiz').questions).toEqual(before.get('assignments/synthetic-quiz').questions);expect(f.rows.get('assignments/synthetic-quiz').answers).toEqual(before.get('assignments/synthetic-quiz').answers)
 expect(f.rows.get('answerKeys/synthetic-quiz')).toEqual(before.get('answerKeys/synthetic-quiz'));expect(f.rows.get('reviews/synthetic-quiz')).toEqual(before.get('reviews/synthetic-quiz'))
 expect(JSON.stringify(f.rows.get('assignments/synthetic-quiz'))).not.toContain(r.reason)
 const history=[...f.rows.entries()].find(([p])=>p.includes('/scopeHistory/'));expect(history[1].reason).toBe(r.reason)
 const skill=f.rows.get('families/synthetic-family/children/synthetic-child/skills/literature-detail');expect(skill.lastOutcome).toBe('unknown');expect(skill.mastery).toBe('previous-independent-state');expect(skill.evidenceIds).toContain('old-evidence')
 const observation=[...f.rows.entries()].find(([p])=>p.includes('/learningEvidence/'))[1];expect(observation.mastery).toBe('not-inferred');expect(observation.criteria[0].result).toBe('unknown')
 const writes=f.writes;await expect(correctAuthorScope(f.db,r,{apply:true})).rejects.toThrow(/устарел/);expect(f.writes).toBe(writes)
})
it.each(['answers','key','source','index','preview','private-review','public-review'])('rejects a stale freshest export after %s changes',async kind=>{
 const f=fixture(),r=await f.request(),path={answers:'assignments/synthetic-quiz',key:'answerKeys/synthetic-quiz',source:'dayPages/source-day',index:f.context.indexPaths[0],preview:'previews/synthetic-preview','private-review':'quizReviewPrivate/synthetic-quiz','public-review':'reviews/synthetic-quiz'}[kind];f.mutate(path,v=>({...v,concurrent:'changed'}))
 await expect(correctAuthorScope(f.db,r,{apply:true})).rejects.toThrow(/устарел/);expect(f.writes).toBe(0)
})
it.each(['assignment','key','source','index','private-review'])('fences a transaction race in %s before all writes',async kind=>{
 const f=fixture(),r=await f.request(),path={assignment:'assignments/synthetic-quiz',key:'answerKeys/synthetic-quiz',source:'dayPages/source-day',index:f.context.indexPaths[1],'private-review':'quizReviewPrivate/synthetic-quiz'}[kind];f.before(()=>f.mutate(path,v=>({...v,raced:true})))
 await expect(correctAuthorScope(f.db,r,{apply:true})).rejects.toThrow(/CAS/);expect(f.writes).toBe(0)
})
it.each(['foreign-owner','foreign-source','foreign-board','unowned-board','wrong-board-role','missing-index','wrong-source-task','foreign-question','fake-quote','changed-prompt','no-proof'])('rejects %s without writes',async kind=>{
 const f=fixture(),r=await f.request()
 if(kind==='foreign-owner')r.context.owner.familyId='another-family'
 if(kind==='foreign-source')f.rows.get('dayOwners/source-day').childId='another-child'
 if(kind==='foreign-board')f.rows.get('dashboard/parent').familyId='foreign-family'
 if(kind==='unowned-board')delete f.rows.get('dashboard/parent').familyId
 if(kind==='wrong-board-role')f.rows.get('dashboard/parent').kind='student'
 if(kind==='missing-index')f.rows.delete(f.context.indexPaths[1])
 if(kind==='wrong-source-task')r.context.source.taskId='mesh-other'
 if(kind==='foreign-question')r.exclusions[0].questionId='foreign-question'
 if(kind==='fake-quote')r.exclusions[0].scopeQuote='Неназначенная тема'
 if(kind==='changed-prompt')r.exclusions[0].questionPrompt='Подменённое условие'
 if(kind==='no-proof')r.exclusions[0].evidenceRefs=[]
 await expect(correctAuthorScope(f.db,r,{apply:true})).rejects.toThrow();expect(f.writes).toBe(0)
})
it('requires the unstarted source-revision path and verifies both role readbacks',async()=>{
 const f=fixture();f.rows.get('assignments/synthetic-quiz').status='open';f.rows.get('assignments/synthetic-quiz').answers={};f.rows.get('assignments/synthetic-quiz').startedAt=null
 await expect(correctAuthorScope(f.db,await f.request(),{apply:true})).rejects.toThrow(/не начатого/);expect(f.writes).toBe(0)
 const g=fixture(),r=await g.request();g.after(()=>g.rows.get(g.context.indexPaths[1]).other='corrupt');await expect(correctAuthorScope(g.db,r,{apply:true})).rejects.toThrow(/Readback/)
})
it('accepts verified registry legacy ownership without assigning a new family to old boards',async()=>{
 const f=fixture();f.context.legacyBoardOwner=clone(f.context.owner)
 f.rows.set('dashboard/learner',{kind:'student'});f.rows.set('dashboard/parent',{kind:'parent'})
 expect(await correctAuthorScope(f.db,await f.request(),{apply:true})).toMatchObject({verified:true})
 expect(f.rows.get('dashboard/parent')).toEqual({kind:'parent'});expect(f.rows.get('dashboard/learner')).toEqual({kind:'student'})
 const g=fixture();g.context.legacyBoardOwner={...g.context.owner,childId:'another-child'};g.rows.set('dashboard/parent',{kind:'parent'});await expect(g.request()).rejects.toThrow(/legacy/)
 const h=fixture();h.context.legacyBoardOwner=clone(h.context.owner);h.rows.set('dashboard/parent',{kind:'parent',familyId:'explicit-foreign'});await expect(h.request()).rejects.toThrow(/другому владельцу/)
})
