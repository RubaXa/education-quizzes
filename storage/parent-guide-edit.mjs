/** @see ../docs/modules/reviews/method-guided-solutions.md */
import {isDeepStrictEqual} from 'node:util'
import {solutionBlocksErrors,solutionMethodErrors} from '../packages/education-presentation/solution-blocks.mjs'
// Reserve two container levels for archiving this guide in guideEdits[].guide.
function storable(value,depth=3,arrayItem=false){
 if(!value||typeof value!=='object')return true
 if(depth>20)return false
 if(Array.isArray(value))return !arrayItem&&value.every(v=>storable(v,depth+1,true))
 return Object.values(value).every(v=>storable(v,depth+1,false))
}
export function parentGuideEditErrors(previous,input){
 const old=previous?.guide,next=input?.guide
 if(input?.version!==1||!old||!next||typeof input.reason!=='string'||input.reason.trim().length<20)return ['Нужны существующий ориентир, новый guide и причина коррекции.']
 if(old.revision!==input.expectedGuideRevision||next.revision!==old.revision+1||previous.sourceRevision!==input.sourceRevision)return ['Ревизия ориентира или исходного задания изменилась.']
 if(['kind','presentation','pattern'].some(k=>next[k]!==old[k])||!Array.isArray(next.stages)||!isDeepStrictEqual(next.stages.map(s=>s.id),old.stages.map(s=>s.id)))return ['ID, порядок и вид этапов должны сохраниться.']
 const errors=solutionMethodErrors(next.method)
 if(!storable(next))errors.push('Guide не помещается в формат Firestore: массивы строк таблицы должны содержать объекты cells; вложенность с историей не больше 20.')
 for(const [i,stage] of next.stages.entries()){
  if(!isDeepStrictEqual(stage.source,old.stages[i].source)||!isDeepStrictEqual(stage.reviewLabels,old.stages[i].reviewLabels))errors.push('Источник и сопоставление проверки должны сохраниться.')
  if(!stage.title?.trim()||stage.title.length>100||!stage.expected?.trim()||stage.expected.length>240||!stage.hintPreview?.trim()||!stage.revealPreview?.trim())errors.push('Первый уровень этапа должен быть коротким и понятным.')
  errors.push(...solutionBlocksErrors(stage.blocks))
 }
 return errors
}
