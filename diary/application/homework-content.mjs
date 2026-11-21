/** Comparison only: preserve raw teacher content and distinct assignment IDs.
 * @see ../../docs/modules/school-diary/README.md#sync */
export function homeworkText(value){
 if(typeof value!=='string')return value
 let text=value.normalize('NFC').replace(/\s+/gu,' ').trim().replace(/([§№])\s+/gu,'$1')
 const parts=text.split(';').map(x=>x.trim())
 // Collapse repeated copies of the WHOLE phrase, not a repeated element in a list.
 if(/\p{L}/u.test(text))for(let size=1;size<=parts.length/2;size++){
  if(parts.length%size===0&&parts.every((p,i)=>p===parts[i%size]))return parts.slice(0,size).join('; ')
 }
 return text
}
export function homeworkContent(item){
 return {...item,
  ...(Array.isArray(item.descriptions)?{descriptions:[...new Set(item.descriptions.map(homeworkText))].sort()}:{}),
  ...(Array.isArray(item.homeworkEntries)?{homeworkEntries:item.homeworkEntries.map(({updatedAt:_updatedAt,...entry})=>({...entry,description:homeworkText(entry.description)}))}:{})}
}
