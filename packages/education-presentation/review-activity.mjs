/** Public manipulatives for an existing question; no solution, evaluator or persistence.
 * @see ../../docs/shared/design/student-review-step.md */
const object=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k))
const text=(v,max=160)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const point=v=>object(v,['x','y'])&&Number.isFinite(v.x)&&v.x>=0&&v.x<=100&&Number.isFinite(v.y)&&v.y>=0&&v.y<=100
const list=(v,max,check)=>Array.isArray(v)&&v.length>0&&v.length<=max&&v.every(check)
const unique=items=>new Set(items.map(i=>i.id)).size===items.length
export function reviewActivityValid(a){
 if(!object(a,['kind','label','instruction','tokens','groups','joiner','repeat','maxItems','frame','diagram'])||!['mark','build','sort','write'].includes(a.kind)
  ||!text(a.label,100)||!text(a.instruction)||!list(a.tokens,40,t=>object(t,['id','text'])&&text(t.id,60)&&text(t.text,160))||!unique(a.tokens))return false
 if(a.kind==='sort'?!list(a.groups,4,g=>object(g,['id','label'])&&text(g.id,60)&&text(g.label,80))||!unique(a.groups):a.groups!==undefined)return false
 if(a.kind==='build'?(a.joiner!==undefined&&![' ',' + ',' · ',' → ',''].includes(a.joiner)||a.repeat!==undefined&&typeof a.repeat!=='boolean'):a.joiner!==undefined||a.repeat!==undefined)return false
 if(a.maxItems!==undefined&&(a.kind!=='build'||!Number.isInteger(a.maxItems)||a.maxItems<1||a.maxItems>20))return false
 if(a.kind==='write'){
  const ids=new Set(a.tokens.map(t=>t.id))
  if(a.tokens.length>4||!list(a.frame,16,p=>object(p,['text','slotId'])&&(typeof p.text==='string'&&p.text.length<=160&&p.slotId===undefined||typeof p.slotId==='string'&&ids.has(p.slotId)&&p.text===undefined))
   ||a.tokens.some(t=>!a.frame.some(p=>p.slotId===t.id)))return false
 }else if(a.frame!==undefined)return false
 if(a.diagram!==undefined){
  const d=a.diagram,ids=new Set(a.tokens.map(t=>t.id))
  if(!object(d,['kind','label','segments','rows','columns','cells','nodes'])||!text(d.label,160))return false
  if(d.kind==='chain'){
   if(d.segments!==undefined||d.rows!==undefined||d.columns!==undefined||d.cells!==undefined||!list(d.nodes,4,n=>text(n,120)))return false
  }else if(d.kind==='lines'){
   if(d.nodes!==undefined)return false
   if(d.rows!==undefined||d.columns!==undefined||d.cells!==undefined||!list(d.segments,30,s=>object(s,['id','from','to','label'])&&ids.has(s.id)&&point(s.from)&&point(s.to)&&(s.label===undefined||text(s.label,20)))||!unique(d.segments))return false
  }else if(d.kind==='grid'){
   if(d.nodes!==undefined)return false
   if(d.segments!==undefined||!Number.isInteger(d.rows)||d.rows<1||d.rows>12||!Number.isInteger(d.columns)||d.columns<1||d.columns>12
    ||!list(d.cells,144,c=>object(c,['row','column','mark','tokenId'])&&Number.isInteger(c.row)&&c.row>=0&&c.row<d.rows&&Number.isInteger(c.column)&&c.column>=0&&c.column<d.columns&&['hit','miss','given'].includes(c.mark)&&(c.tokenId===undefined||ids.has(c.tokenId)))
    ||new Set(d.cells.map(c=>`${c.row}:${c.column}`)).size!==d.cells.length)return false
  }else return false
 }
 return true
}
export function projectReviewActivity(value){return reviewActivityValid(value)?JSON.parse(JSON.stringify(value)):undefined}
