import {expect,it} from 'vitest'
import {projectSolutionBlocks,solutionBlocksErrors,validMathExpression} from './solution-blocks.mjs'
import {projectGuidanceReveal} from '../../day/guidance-release.mjs'
it('keeps structured mathematics and one explicitly released stage without neighbouring private content',()=>{
 const blocks=[{kind:'formula',label:'Общая сумма',expression:{kind:'row',items:[{kind:'symbol',value:'S'},{kind:'operator',value:'='},{kind:'number',value:'12'}]}}]
 expect(solutionBlocksErrors(blocks)).toEqual([])
 const stage={title:'Один этап',expected:'Подготовленный шаг.',blocks,source:{label:'Учебный источник',ref:'PRIVATE-REF',excerpt:'PRIVATE-EXCERPT'},nextStages:['CLOSED-NEXT']}
 const reveal=projectGuidanceReveal(stage)
 expect(reveal.blocks).toEqual(blocks)
 expect(JSON.stringify(reveal)).not.toMatch(/PRIVATE|CLOSED/)
 expect(projectSolutionBlocks([{...blocks[0],responseCriterion:'CLOSED'}])).toBeUndefined()
 expect(validMathExpression({kind:'number',value:'12',branches:{correct:'CLOSED'}})).toBe(false)
})
it('does not permit an unbounded nested tree of cases or invalid mathematical markup',()=>{
 const nested={kind:'cases',label:'Все случаи',cases:[{label:'Один случай',result:'Проверка',blocks:[{kind:'cases',label:'Ещё случаи',cases:[]}]}]}
 expect(solutionBlocksErrors([nested]).length).toBeGreaterThan(0)
 expect(validMathExpression({kind:'operator',value:'<script>'})).toBe(false)
 expect(validMathExpression({kind:'fraction',numerator:{kind:'number',value:'1'},denominator:{kind:'number',value:'2'}})).toBe(true)
})
