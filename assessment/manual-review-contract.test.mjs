import {expect,it} from 'vitest'
import {assertManualQuizReview,quizAttemptDigest,publicManualReview,privateQuizKey,quizReviewDigest,assertQuizReviewRevision,textReviewMigration} from './manual-review-contract.mjs'
import {pendingManualQuestionIds} from './decision-graph.mjs'
import {publishedAnswer} from './question-guidance.mjs'
const assignment={testId:'test',familyId:'family',childId:'child',status:'submitted',questions:[{id:'q1',kind:'long',points:2,prompt:'Письмо о национальном блюде'}],answers:{q1:'Письмо ученика'}}
const key={entries:{q1:{criteria:[{id:'topic',description:'Национальное блюдо',skillId:'english-topic',skillLabel:'Содержание',maxPoints:1},{id:'language',description:'Язык',skillId:'english-language',skillLabel:'Язык',maxPoints:1}]}}}
const review=()=>({attemptFingerprint:quizAttemptDigest(assignment,key),priorReviewFingerprint:quizReviewDigest(null),correctionReason:'',entries:{q1:{points:1,explanation:'Язык верен, тема не соответствует условию.',criteriaChecks:[{id:'topic',points:0,observation:'Названо другое блюдо'},{id:'language',points:1,observation:'Грамматические формы верны'}]}}})
it('migrates only open text policy, queues even an exact short answer and requires semantic criteria',()=>{
 const a={...assignment,status:'open',questions:[{id:'q',kind:'short',points:1,prompt:'Назови источник сообщения'}],answers:{q:'другим известиям'},startedAt:'unchanged'}
 const k={entries:{q:{correct:'другим известиям'}}},before=structuredClone(a)
 const patch=textReviewMigration(a,k)
 expect(patch.assignmentPatch).toEqual({textAnswerReviewVersion:1})
 expect(a).toEqual(before)
 expect(patch.rubrics.q[0].description).toBe(a.questions[0].prompt)
 expect(textReviewMigration({...a,status:'submitted'},k)).toBeNull()
 const legacy={...a,questions:[...a.questions,{id:'old-long',kind:'long',points:2,prompt:'Старое объяснение'}]}
 expect(textReviewMigration(legacy,{entries:{...k.entries,'old-long':{}}},{rubrics:{unrelated:[{id:'kept'}]}}).rubrics).toEqual({...patch.rubrics,unrelated:[{id:'kept'}]})
 const migrated={...a,...patch.assignmentPatch,status:'submitted'}
 const privateKey=privateQuizKey(k,{rubrics:patch.rubrics})
 expect(pendingManualQuestionIds(migrated,{})).toEqual(['q'])
 const r={attemptFingerprint:quizAttemptDigest(migrated,privateKey),entries:{}}
 expect(()=>assertManualQuizReview(migrated,privateKey,r)).toThrow(/непроверенным/)
 r.entries.q={points:1,explanation:'Смысл верен по оригиналу.',criteriaChecks:[{id:'answer',points:1,observation:'Назван нужный источник.'}]}
 expect(assertManualQuizReview(migrated,privateKey,r)).toHaveLength(1)
 expect(pendingManualQuestionIds(migrated,r)).toEqual([])
})
it('requires every criterion, bounded points, current attempt and existing answered question',()=>{
 expect(assertManualQuizReview(assignment,key,review())).toHaveLength(2)
 const r=review();r.entries.q1.criteriaChecks.pop();expect(()=>assertManualQuizReview(assignment,key,r)).toThrow(/пропустил/)
 expect(()=>assertManualQuizReview({...assignment,answers:{q1:'Другой ответ'}},key,review())).toThrow(/изменились/)
 expect(()=>assertManualQuizReview(assignment,key,{...review(),entries:{q2:review().entries.q1}})).toThrow()
 const bad=review();bad.entries.q1.points=3;expect(()=>assertManualQuizReview(assignment,key,bad)).toThrow()
 expect(()=>assertManualQuizReview(assignment,key,{...review(),entries:{}})).toThrow(/непроверенным/)
 expect(publicManualReview(review()).entries.q1).not.toHaveProperty('criteriaChecks')
})
it('keeps full rubrics out of link-readable keys and rejects stale or unexplained corrections',()=>{
 expect(publishedAnswer(key.entries.q1)).not.toHaveProperty('criteria')
 expect(privateQuizKey({entries:{q1:{}}},{rubrics:{q1:key.entries.q1.criteria}}).entries.q1.criteria).toEqual(key.entries.q1.criteria)
 const prior=review(),next=review();next.entries.q1.points=2
 expect(()=>assertQuizReviewRevision(prior,next)).toThrow(/изменился/)
 next.priorReviewFingerprint=quizReviewDigest(prior)
 expect(()=>assertQuizReviewRevision(prior,next)).toThrow(/причины/)
 next.correctionReason='Повторно сверены критерии'
 expect(assertQuizReviewRevision(prior,next)).toBe('changed')
 expect(assertQuizReviewRevision(prior,prior)).toBe('unchanged')
})
it('regrades the same entries when the key or rubric changed instead of skipping the new knowledge write',()=>{
 const previous={entries:{},attemptFingerprint:'old-source'}
 const next={entries:{},attemptFingerprint:'new-source',priorReviewFingerprint:quizReviewDigest(previous),correctionReason:'Исправлен ключ по первоисточнику'}
 expect(assertQuizReviewRevision(previous,next)).toBe('changed')
 expect(assertQuizReviewRevision(next,next)).toBe('unchanged')
})


it('author-excluded questions require no manual score and produce no skill finding',()=>{
 const a={...assignment,authorScopeExclusions:{version:1,revision:1,questionIds:['q1']}}
 const empty={...review(),attemptFingerprint:quizAttemptDigest(a,key),entries:{}}
 expect(assertManualQuizReview(a,key,empty)).toEqual([])
 expect(()=>assertManualQuizReview(a,key,{...review(),attemptFingerprint:quizAttemptDigest(a,key)})).toThrow(/Исключённый/)
})
