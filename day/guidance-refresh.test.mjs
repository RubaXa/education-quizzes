import { describe, expect, it } from 'vitest'
import { refreshGuides, assertRefreshReadback, assertRefreshPreflight, assertPolicyChecks, guidancePolicyRevision } from './guidance-refresh.mjs'
import { sourcePlanFingerprint } from './pipeline-contract.mjs'
const problem = { id:'p1', original:{text:'exact teacher source'}, support:{revision:2,state:'provisional'},
  parentGuide:{revision:1,stages:[{id:'solution',role:'solution',source:{ref:'original'},answer:'untouched'}]} }
const source = { subjects:[{id:'math',tasks:[{id:'task',optionalByTeacher:true,problems:[problem]}]}] }
const update = { taskId:'p1',firstQuestion:'Which step have you reached?',stages:[{id:'solution',expected:'Reviewed reasoning',rows:[{value:'A concrete transition'}],hintPreview:'A question',revealPreview:'An explanation'}] }
describe('authored guidance refresh fences',()=>{
  it('requires explicit current-policy acknowledgement of both semantic reviews for the whole exact scope',()=>{
    const check={confirmed:true,basis:'Human reviewed the actual source and current learner evidence.',reviewedTaskIds:['p1']}
    const plan={policyRevision:guidancePolicyRevision,checks:{policyRevision:guidancePolicyRevision,adultReadability:check,targetedHint:check}}
    expect(()=>assertPolicyChecks(plan,[update])).not.toThrow()
    expect(()=>assertPolicyChecks({...plan,policyRevision:'old'},[update])).toThrow('guidance_policy_review_stale')
    expect(()=>assertPolicyChecks({...plan,checks:{...plan.checks,targetedHint:undefined}},[update])).toThrow('missing_operator_review:targetedHint')
    expect(()=>assertPolicyChecks(plan,[update,{...update,taskId:'p2'}])).toThrow('missing_operator_review')
  })
  it('changes only authored guidance and revision, preserving source, stage IDs, answer and optionality',()=>{
    const next=refreshGuides(source,[update]); const p=next.subjects[0].tasks[0].problems[0]
    expect(p.parentGuide.revision).toBe(2); expect(p.support.revision).toBe(3)
    expect(p.original).toEqual(problem.original);expect(p.parentGuide.stages[0].source).toEqual({ref:'original'})
    expect(p.parentGuide.stages[0].answer).toBe('untouched');expect(next.subjects[0].tasks[0].optionalByTeacher).toBe(true)
    expect(source.subjects[0].tasks[0].problems[0].parentGuide.revision).toBe(1)
  })
  it('rejects missing targets and changes to stage identities or source',()=>{
    expect(()=>refreshGuides(source,[])).toThrow('incomplete_day_scope')
    expect(()=>refreshGuides(source,[{...update,stages:[{...update.stages[0],id:'other'}]}])).toThrow('stage_identity_changed')
    expect(()=>refreshGuides(source,[{...update,stages:[{...update.stages[0],source:{ref:'forged'}}]}])).toThrow('invalid_authored_stage')
  })
  it('detects stale/private/foreign data rather than declaring a successful write',()=>{
    const next=refreshGuides(source,[update]);const p=next.subjects[0].tasks[0].problems[0]
    const pub=structuredClone(next);delete pub.subjects[0].tasks[0].problems[0].parentGuide;pub.sourcePlanFingerprint=sourcePlanFingerprint(next)
    const args={beforePages:[pub,pub],afterPages:[pub,pub],source:next,guides:{p1:{guide:p.parentGuide}},beforeEvidence:{status:'verified'},afterEvidence:{status:'verified'}}
    expect(assertRefreshReadback(args)).toBe(1)
    expect(()=>assertRefreshReadback({...args,afterPages:[{...pub,sourcePlanFingerprint:'stale'},pub]})).toThrow('publication_fingerprint_stale')
    expect(()=>assertRefreshReadback({...args,afterEvidence:{status:'unknown'}})).toThrow('learning_evidence_changed')
    expect(()=>assertRefreshReadback({...args,guides:{p1:{guide:problem.parentGuide}}})).toThrow('guide_readback_mismatch')
    expect(()=>assertRefreshReadback({...args,afterPages:[next,pub]})).toThrow()
  })
  it('rejects changed live guidance or original before a publication can overwrite it',()=>{
    const newer=refreshGuides(source,[update]);const pub=structuredClone(source);delete pub.subjects[0].tasks[0].problems[0].parentGuide
    const before={owner:{familyId:'f',childId:'c'},pages:[pub,pub],evidence:{},guides:{p1:{guide:problem.parentGuide}}}
    expect(()=>assertRefreshPreflight(before,structuredClone(before),newer)).not.toThrow()
    const changed=structuredClone(before);changed.guides.p1.guide.revision=9
    expect(()=>assertRefreshPreflight(before,changed,newer)).toThrow('stale_live_guide')
    const sourceChanged=structuredClone(newer);sourceChanged.subjects[0].tasks[0].problems[0].original.text='obsolete local original'
    expect(()=>assertRefreshPreflight(before,before,sourceChanged)).toThrow('local_original_differs_from_live_source')
    const liveChanged=structuredClone(before);liveChanged.pages[0].subjects[0].tasks[0].problems[0].original.text='new teacher original'
    expect(()=>assertRefreshPreflight(before,liveChanged,newer)).toThrow('stale_live_page')
  })
})
