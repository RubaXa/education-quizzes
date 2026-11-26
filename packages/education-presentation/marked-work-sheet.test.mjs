import {describe,it,expect} from 'vitest'
import {markedWorkSheetValid} from './marked-work-sheet.mjs'
import {projectReviewSupplement} from './review-content.mjs'
export const sheet={version:1,title:'Моя запись',blocks:[{id:'line',uploadId:'photo',location:'Строка 2',parts:[{text:'It '},{text:'haved',mark:{id:'verb',status:'incorrect',comment:'У этого глагола особая прошедшая форма.'}},{text:' a mask.'}]}]}
describe('marked written sheet',()=>{
 it('projects exactly the authored public transcription without a key or inferred verdict',()=>{
  expect(markedWorkSheetValid(sheet)).toBe(true)
  expect(projectReviewSupplement({version:1,sheet})).toEqual({version:1,sheet})
  expect(projectReviewSupplement({version:1,sheet:{...sheet,answerKey:'secret'}})).toBeUndefined()
 })
 it('rejects duplicate marks, unanchored blocks and unknown private nested fields',()=>{
  for(const mutate of [s=>s.blocks.push(s.blocks[0]),s=>s.blocks[0].uploadId='',s=>s.blocks[0].parts[1].mark.solution='secret',s=>s.blocks[0].parts.push(s.blocks[0].parts[1])]){
   const s=structuredClone(sheet);mutate(s);expect(markedWorkSheetValid(s)).toBe(false)
  }
 })
})
