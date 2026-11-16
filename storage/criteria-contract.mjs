import {createHash} from 'node:crypto'
/** Frozen source inventory is independent of the later reviewer-selected findings.
 * @see ../docs/modules/reviews/criteria-and-knowledge.md */
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{1,100}$/.test(value)
const text=value=>typeof value==='string'&&value.trim().length>0
export function assignmentDigest(task){return digest({id:task.id,meshText:task.meshText??null,detail:task.detail??null,sourceRevision:task.sourceRevision??null,decisionRuleIds:task.decisionRuleIds??null,problems:(task.problems??[]).map(p=>({id:p.id,number:p.number,original:p.original??null})),sourceInventory:task.sourceInventory??null})}
export function assignedCriteriaSources(page,taskId){
 const parent=page.subjects?.flatMap(s=>s.tasks??[]).find(t=>t.id===taskId||t.problems?.some(p=>p.id===taskId))
 if(!parent)throw Error('Не найдено назначение для описи источников.')
 const links=(page.materialLinks?.[parent.id]??[]).filter(l=>['teacher-attachment','textbook-page'].includes(l.sourceType)).map(l=>{
  const ref=text(l.sourceRef)?l.sourceRef:l.url
  if(!text(ref))throw Error('У назначенного материала нет адресной ссылки; сначала восстановите связь.')
  return {ref,sha256:l.sourceSha256??null}
 }).sort((a,b)=>a.ref<b.ref?-1:a.ref>b.ref?1:0)
 const pages=page.taskPageRefs?.[parent.id]??[]
 return {sourceRefs:[...new Set([...links.map(l=>l.ref),...pages])],sourceFingerprint:digest({links,pages})}
}
export function freezeCriteria(manifest,{task,planRevision,sourceRefs=[],sourceFingerprint=digest(sourceRefs)}){
 if(!task?.id||!Number.isInteger(planRevision)||!manifest||manifest.taskId!==task.id||manifest.planRevision!==planRevision||manifest.assignmentDigest!==assignmentDigest(task))throw Error('Критерии относятся к другому заданию или устаревшему источнику.')
 if(!text(manifest.materialFingerprint)||manifest.materialFingerprint!==sourceFingerprint)throw Error('Назначенный материал изменился или отсутствует обязательный отпечаток; нужен новый экспорт и сверка.')
 if(!Array.isArray(manifest.sources)||!manifest.sources.length||!Array.isArray(manifest.criteria)||!manifest.criteria.length||new Set(manifest.criteria.map(c=>c.id)).size!==manifest.criteria.length)throw Error('Нужны полные источники и неповторяющиеся критерии.')
 const primary=task.familyOrigin?'family':'mesh'
 const refs=new Set([primary,...sourceRefs]);
 if(new Set(manifest.sources.map(s=>s.ref)).size!==manifest.sources.length)throw Error('Опись повторяет один источник.')
 for(const source of manifest.sources){
  if(!refs.has(source.ref)||!text(source.text)||!Array.isArray(source.segments)||!source.segments.length||source.segments.map(s=>s.text).join('')!==source.text)throw Error('Разметка должна покрывать весь текст источника без пропусков.')
  for(const segment of source.segments){
   if(!text(segment.text)||!['requirement','context'].includes(segment.kind)||segment.kind==='context'&&!text(segment.reason)||segment.kind==='requirement'&&(!segment.criterionIds?.length||segment.criterionIds.some(key=>!manifest.criteria.some(c=>c.id===key&&c.sourceRef===source.ref))))throw Error('Каждый фрагмент требования должен быть связан с критерием; контекст требует основания.')
  }
  if(source.ref===primary&&source.text!==(task.familyOrigin?task.detail:task.meshText??task.detail))throw Error('Точная запись назначения изменилась.')
 }
 for(const criterion of manifest.criteria){
  const source=manifest.sources.find(s=>s.ref===criterion.sourceRef)
  if(!id(criterion.id)||!id(criterion.skillId)||!text(criterion.skillLabel)||!text(criterion.action)||typeof criterion.required!=='boolean'||!source||!text(criterion.quote)||!source.text.includes(criterion.quote)||!source.segments.some(s=>s.kind==='requirement'&&s.criterionIds.includes(criterion.id)))throw Error('Каждому критерию нужны действие, навык и точная опора в полном источнике.')
  if(criterion.required===false&&(!criterion.optionalBySource||criterion.optionalBySource.ref!==criterion.sourceRef||!text(criterion.optionalBySource.quote)||!criterion.quote.includes(criterion.optionalBySource.quote)||!/по желанию|необязательн|если хочешь|optional|if you wish/iu.test(criterion.optionalBySource.quote)))throw Error('Обязательный критерий нельзя выключить флагом: нужна точная помета необязательности именно этого действия.')
 }
 if(!manifest.sources.some(s=>s.ref===primary)||sourceRefs.some(ref=>!manifest.sources.some(s=>s.ref===ref)))throw Error('Опись не охватывает все назначенные источники.')
 const {fingerprint:_fingerprint,...original}=manifest
 const body={...original,materialFingerprint:sourceFingerprint}
 return {...body,fingerprint:digest(body)}
}
export function assertCriteriaCoverage(review,contract,{task,planRevision,sourceRefs=[],sourceFingerprint=digest(sourceRefs)}){
 if(review.purpose==='source-material')return []
 if(!contract){if(review.status==='cannot-assess')return [];throw Error('До зачёта и содержательного вердикта нужна отдельная сохранённая опись критериев. Сначала submissions criteria.')}
 const actual=freezeCriteria(contract,{task,planRevision,sourceRefs,sourceFingerprint})
 if(actual.fingerprint!==contract.fingerprint||review.criteriaFingerprint!==contract.fingerprint)throw Error('Критерии изменились; перечитайте их перед проверкой.')
 const checks=review.criteriaChecks
 if(!Array.isArray(checks)||new Set(checks.map(c=>c.id)).size!==checks.length||checks.length!==contract.criteria.length||contract.criteria.some(c=>!checks.some(x=>x.id===c.id)))throw Error('Пропущен критерий: нужна отдельная сверка каждого пункта описи.')
 for(const finding of checks){
  if(!['confirmed','not-met','partial','unknown'].includes(finding.result)||!text(finding.observation)||!text(finding.location)||!review.uploadIds?.includes(finding.uploadId))throw Error('Для критерия нужны результат и точное место в текущей работе.')
  const criterion=contract.criteria.find(c=>c.id===finding.id)
  if(review.status==='verified'&&criterion.required&&finding.result!=='confirmed')throw Error('Нельзя зачесть работу с ошибкой, неполнотой или неизвестным обязательным критерием.')
  if(criterion.required&&(!id(finding.stageId)||!review.items?.some(item=>item.stageId===finding.stageId)))throw Error('Обязательный критерий должен быть связан с видимым пунктом разбора.')
 }
 const stageIds=[...new Set(checks.filter(f=>contract.criteria.find(c=>c.id===f.id).required).map(f=>f.stageId))]
 for(const stageId of stageIds){
  const results=checks.filter(f=>f.stageId===stageId&&contract.criteria.find(c=>c.id===f.id).required).map(f=>f.result)
  const expected=results.includes('not-met')?'incorrect':results.includes('partial')?'partial':results.includes('unknown')?'cannot-assess':'correct'
  if(review.items.find(item=>item.stageId===stageId)?.status!==expected)throw Error('Видимый результат этапа противоречит проверке его критериев.')
 }
 return contract.criteria.map(c=>({...c,finding:checks.find(x=>x.id===c.id)}))
}
