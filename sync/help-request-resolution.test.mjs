import { describe, expect, it } from 'vitest'
import { helpRequestResolution } from './help-request-resolution.mjs'
/** @see ../docs/modules/synchronization/education-pipeline.md#sync-inbox */
const at = seconds => ({ seconds, nanoseconds: 0 })
const request = { requestedAt: at(20) }
const review = { status: 'partial', checkedAt: at(10) }
const accepted = { id:'a',taskId:'p5',action:'accept',actorPersonId:'parent',reviewCheckedAt:at(10),decidedAt:at(30) }
const resolve = (overrides={}) => helpRequestResolution({taskId:'p5',request,review,decisions:[accepted],...overrides})
describe('help closure follows the same reviewed attempt', () => {
  it('closes a request only after the family accepts that attempt, preserving input', () => {
    const before=JSON.stringify({request,review,accepted})
    expect(resolve()).toBe('later-family-acceptance')
    expect(JSON.stringify({request,review,accepted})).toBe(before)
  })
  it('keeps a new request after acceptance open', () => {
    expect(resolve({request:{requestedAt:at(31)}})).toBeNull()
  })
  it('rejects another task, review version, missing actor or timestamp', () => {
    for(const change of [{taskId:'p6'},{reviewCheckedAt:at(9)},{actorPersonId:null},{decidedAt:null}])
      expect(resolve({decisions:[{...accepted,...change}]})).toBeNull()
    expect(resolve({request:{}})).toBeNull()
  })
  it('keeps a later reopened attempt open regardless of event order', () => {
    expect(resolve({decisions:[{...accepted,id:'b',action:'reopen',decidedAt:at(40)},accepted]})).toBeNull()
    expect(resolve({review:{...review,checkedAt:at(40)}})).toBeNull()
    expect(resolve({review:{status:'verified',checkedAt:at(25)},decisions:[
      {...accepted,reviewCheckedAt:at(25),action:'reopen',decidedAt:at(40)}]})).toBeNull()
  })
  it('does not treat partial, a changed support revision, or old verification as a reply', () => {
    expect(resolve({decisions:[]})).toBeNull()
    expect(resolve({review:{...review,status:'verified'},decisions:[]})).toBeNull()
    expect(resolve({review:{status:'verified',checkedAt:at(25)},decisions:[]})).toBe('later-student-work-verified')
  })
})
