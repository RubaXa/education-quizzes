/** @see ../../docs/modules/reviews/method-guided-solutions.md */
import {reviewVisualValid} from './review-content.mjs'
const text=(v,max=600)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k))
const operators=new Set(['+','−','-','×','·','÷',':','=','≠','<','>','≤','≥','∈',';',',','⋯','→','⇒','(',')','{','}','|'])
export function validMathExpression(v,depth=0){
 if(depth>8||!v)return false
 if(['number','symbol','operator','text'].includes(v.kind))return keys(v,['kind','value'])&&text(v.value,80)
  &&(v.kind!=='number'||/^-?\d+(?:[.,]\d+)?$/.test(v.value))&&(v.kind!=='operator'||operators.has(v.value))
 if(v.kind==='row')return keys(v,['kind','items'])&&Array.isArray(v.items)&&v.items.length>0&&v.items.length<=40&&v.items.every(n=>validMathExpression(n,depth+1))
 if(v.kind==='fraction')return keys(v,['kind','numerator','denominator'])&&validMathExpression(v.numerator,depth+1)&&validMathExpression(v.denominator,depth+1)
 if(v.kind==='power')return keys(v,['kind','base','exponent'])&&validMathExpression(v.base,depth+1)&&validMathExpression(v.exponent,depth+1)
 return false
}
function validBlocks(blocks,depth=0){
 return Array.isArray(blocks)&&blocks.length>0&&blocks.length<=24&&blocks.every(b=>{
  if(b?.kind==='text')return keys(b,['kind','title','text'])&&text(b.text)&&(b.title===undefined||text(b.title,120))
  if(b?.kind==='formula')return keys(b,['kind','label','expression'])&&text(b.label,160)&&validMathExpression(b.expression)
  if(b?.kind==='visual')return keys(b,['kind','visual'])&&reviewVisualValid(b.visual)
  if(b?.kind==='source'){try{return keys(b,['kind','label','url'])&&text(b.label,160)&&text(b.url,2000)&&new URL(b.url).protocol==='https:'}catch{return false}}
  if(b?.kind==='grid')return keys(b,['kind','label','rows','columns','cells','columnLabels','rowLabels'])&&text(b.label,160)&&[b.rows,b.columns].every(n=>Number.isInteger(n)&&n>0&&n<=12)&&(b.columnLabels===undefined||Array.isArray(b.columnLabels)&&b.columnLabels.length===b.columns&&b.columnLabels.every(v=>text(v,8)))&&(b.rowLabels===undefined||Array.isArray(b.rowLabels)&&b.rowLabels.length===b.rows&&b.rowLabels.every(v=>text(v,8)))&&Array.isArray(b.cells)&&b.cells.length<=144&&b.cells.every(c=>keys(c,['row','column','mark','label'])&&Number.isInteger(c.row)&&c.row>=0&&c.row<b.rows&&Number.isInteger(c.column)&&c.column>=0&&c.column<b.columns&&['first','second','cut','focus'].includes(c.mark)&&(c.label===undefined||text(c.label,12)))
  if(b?.kind==='graph')return keys(b,['kind','label','nodes','edges'])&&text(b.label,160)&&Array.isArray(b.nodes)&&b.nodes.length>0&&b.nodes.length<=12&&b.nodes.every(n=>keys(n,['id','label','x','y'])&&text(n.id,50)&&text(n.label,60)&&[n.x,n.y].every(p=>typeof p==='number'&&p>=0&&p<=100))&&new Set(b.nodes.map(n=>n.id)).size===b.nodes.length&&Array.isArray(b.edges)&&b.edges.length<=30&&b.edges.every(e=>keys(e,['from','to'])&&b.nodes.some(n=>n.id===e.from)&&b.nodes.some(n=>n.id===e.to))
  if(b?.kind==='flow')return keys(b,['kind','label','steps'])&&text(b.label,160)&&Array.isArray(b.steps)&&b.steps.length>1&&b.steps.length<=6&&b.steps.every(s=>text(s,100))
  if(b?.kind==='cases')return depth===0&&keys(b,['kind','label','cases'])&&text(b.label,160)&&Array.isArray(b.cases)&&b.cases.length>0&&b.cases.length<=12&&b.cases.every(c=>keys(c,['label','result','blocks'])&&text(c.label,100)&&text(c.result,160)&&validBlocks(c.blocks,depth+1))
  return false
 })
}
export function solutionBlocksErrors(blocks){return blocks===undefined||validBlocks(blocks)?[]:['Нужны проверенные блоки решения: короткий текст, формулы, схемы или конечные случаи без закрытых дополнительных полей.']}
export function projectSolutionBlocks(blocks){return blocks===undefined||solutionBlocksErrors(blocks).length?undefined:JSON.parse(JSON.stringify(blocks))}
export function solutionMethodErrors(method){return method===undefined||keys(method,['name','reason','steps'])&&text(method.name,100)&&text(method.reason,240)&&Array.isArray(method.steps)&&method.steps.length>1&&method.steps.length<=6&&method.steps.every(s=>text(s,100))?[]:['Нужно назвать метод, объяснить выбор и показать короткую последовательность переходов.']}
