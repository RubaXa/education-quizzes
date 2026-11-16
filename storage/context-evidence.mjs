/** @see ../docs/decisions/assignment-source-audit-corrections-2026-11-16.md */
import {createHash} from 'node:crypto'
import {contextEvidenceFields as fields} from './context-evidence-projection.mjs'
export {contextEvidenceProjection} from './context-evidence-projection.mjs'
/** A receipt records an observed result, never an assignment verdict.
 * @see ../docs/modules/reviews/review-criteria-provenance.md#context-evidence
 */
const text=(value,max)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=max
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value
export function contextEvidenceErrors(packet){
 const errors=[],e=packet?.evidence
 if(packet?.purpose!=='context-evidence'||!e||typeof e!=='object'||Array.isArray(e))return ['Нужна квитанция context-evidence с наблюдаемым результатом.']
 const allowed=new Set(['purpose','date','taskId','planRevision','uploadIds','evidence'])
 if(Object.keys(packet).some(key=>!allowed.has(key)))errors.push('Квитанция контекста не принимает вердикт, критерии, полноту, учебное наблюдение или пакет проверок.')
 if(!date(packet.date)||!Number.isInteger(packet.planRevision)||packet.planRevision<1||!/^[a-z0-9-]+$/.test(packet.taskId??'')
  ||!Array.isArray(packet.uploadIds)||packet.uploadIds.length!==1||!/^[A-Za-z0-9_-]{20,}$/.test(packet.uploadIds[0]??''))errors.push('Нужны дата, ревизия, задание и один адресный снимок.')
 if(Object.keys(e).some(key=>!fields.includes(key))||e.type!=='platform-result'||!text(e.title,120)||!text(e.location,180)||!text(e.summary,300)
  ||!date(e.observedDate)||!packet.uploadIds?.includes(e.uploadId)
  ||!Number.isFinite(e.points)||!Number.isFinite(e.maxPoints)||e.points<0||e.maxPoints<=0||e.points>e.maxPoints
  ||!Number.isInteger(e.duration)||e.duration<1||e.duration>1440)errors.push('У результата нужны название, баллы, длительность в минутах, дата наблюдения и точное место на указанном снимке.')
 return errors
}
export function appendContextEvidence(previous,packet,now){
 const errors=contextEvidenceErrors(packet);if(errors.length)throw Error(errors.join(' '))
 const evidence=Object.fromEntries(fields.map(key=>[key,packet.evidence[key]]))
 const id=createHash('sha256').update(JSON.stringify([packet.taskId,packet.date,evidence])).digest('hex')
 const receipts=previous?.contextEvidence??[]
 if(receipts.some(r=>r.id===id))return previous
 return {...(previous??{date:packet.date,taskId:packet.taskId,planRevision:packet.planRevision}),contextEvidence:[...receipts,{id,purpose:'context-evidence',...evidence,checkedAt:now}]}
}
