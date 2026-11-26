/** Author-supplied transcription, never OCR, a key or a client-side grade.
 * @see ../../docs/modules/reviews/marked-work-sheet.md#данные-и-приватность */
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k))
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)
export function markedWorkSheetValid(sheet){
 if(!keys(sheet,['version','title','blocks'])||sheet.version!==1||!text(sheet.title,160)||!Array.isArray(sheet.blocks)||!sheet.blocks.length||sheet.blocks.length>60)return false
 const blocks=new Set(),marks=new Set();let size=0,count=0
 for(const b of sheet.blocks){
  if(!keys(b,['id','uploadId','location','parts'])||!id(b.id)||blocks.has(b.id)||!id(b.uploadId)||!text(b.location,240)||!Array.isArray(b.parts)||!b.parts.length||b.parts.length>200)return false
  blocks.add(b.id)
  for(const p of b.parts){
   if(!keys(p,['text','mark'])||typeof p.text!=='string'||!p.text.length||p.text.length>12000)return false
   size+=p.text.length
   if(p.mark!==undefined){const m=p.mark
    if(!keys(m,['id','status','comment'])||!id(m.id)||marks.has(m.id)||!['correct','incorrect','partial','unreadable','corrected'].includes(m.status)||!text(m.comment,1200)||!p.text.trim())return false
    marks.add(m.id);size+=m.comment.length;count++
   }
  }
 }
 return size<=64000&&count<=200
}
