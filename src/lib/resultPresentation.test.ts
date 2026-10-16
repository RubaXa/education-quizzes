import { describe, expect, it } from 'vitest'
import { resultPresentation } from './resultPresentation'

/** @see ../../docs/product/result-presentation-proposal.md */
describe('one result policy before rounding', () => {
  it.each([[0,'error','0%'],[49.99,'error','49,99%'],[50,'attention','50%'],[84.99,'attention','84,99%'],[85,'success','85%'],[99.99,'success','99,99%'],[100,'success','100%']])('%s', (points, tone, label) => {
    expect(resultPresentation({kind:'score',points:Number(points),maxPoints:100})).toMatchObject({tone,label})
  })
  it.each([[undefined,10],[0,0],[-1,10],[11,10],[NaN,10],[10,Infinity]])('invalid score %s/%s is unknown, never zero', (points,maxPoints) => {
    expect(resultPresentation({kind:'score',points,maxPoints})).toEqual({tone:'neutral',status:'unknown',label:'Нет результата'})
  })
  it('does not treat full answer entry or pending review as success', () => {
    expect(resultPresentation({kind:'answers',answered:5,total:5})).toMatchObject({tone:'accent',value:100})
    expect(resultPresentation({kind:'answers',answered:0,total:5})).toMatchObject({tone:'neutral',value:0,status:'ready'})
    expect(resultPresentation({kind:'answers',answered:.5,total:5}).value).toBeUndefined()
    expect(resultPresentation({kind:'waiting'})).toEqual({tone:'waiting',status:'waiting',label:'Ждёт проверки'})
  })
  it('keeps a perfect score distinct from 99.999 and computes by points', () => {
    expect(resultPresentation({kind:'score',points:99.999,maxPoints:100}).label).toBe('99,99%')
    expect(resultPresentation({kind:'score',points:6,maxPoints:11})).toMatchObject({tone:'attention',label:'55%'})
  })
})
