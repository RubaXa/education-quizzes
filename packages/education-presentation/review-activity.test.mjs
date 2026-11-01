/** @see ../../docs/shared/design/student-review-step.md */
import{expect,it}from'vitest'
import{projectReviewActivity,reviewActivityValid}from'./review-activity.mjs'
import{projectReviewSupplement}from'./review-content.mjs'
const activity=()=>({kind:'mark',label:'Current line',instruction:'Select a fragment.',tokens:[{id:'a',text:'Given'}],diagram:{kind:'lines',label:'Given model',segments:[{id:'a',from:{x:0,y:0},to:{x:90,y:90}}]}})
it('rejects a hidden key at each nesting level and validates token-to-model links',()=>{for(const mutate of[a=>a.answer='closed',a=>a.tokens[0].correct=true,a=>a.diagram.segments[0].expected=true,a=>a.diagram.segments[0].id='missing',a=>a.diagram.segments[0].from.x=Infinity,a=>a.tokens.push({...a.tokens[0]})]){const a=activity();mutate(a);expect(reviewActivityValid(a)).toBe(false);expect(projectReviewSupplement({version:1,activity:a})).toBeUndefined()}})
it('deep-clones a public model and rejects non-finite, oversized or ambiguous models',()=>{const a=activity();const p=projectReviewActivity(a);p.tokens[0].text='changed';expect(a.tokens[0].text).toBe('Given');expect(reviewActivityValid({...a,kind:'sort'})).toBe(false);expect(reviewActivityValid({...a,tokens:Array.from({length:41},(_,i)=>({id:String(i),text:'x'}))})).toBe(false)})
