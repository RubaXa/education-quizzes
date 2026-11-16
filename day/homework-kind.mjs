/** One classification contract for the operator pipeline and the Firebase client.
 * @see ../docs/modules/synchronization/plan-generation.md#raw-mesh-stage */
export function isExplicitCdzTask(task) {
  const source = task.meshText?.trim()
  return task.kind === 'check' && (source
    ? /(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(source)
    : task.id?.endsWith('-cdz') || /(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(task.title ?? ''))
}

/** Service counters describe inventory, never an assigned pupil action.
 * @see ../docs/modules/synchronization/subject-decision-graph.md#teacher-obligation */
export function hasAssignedPlatformWork(task={}) {
 const explicit=value=>{
  if(typeof value!=='string'||/цдз[^.\n]{0,25}не (?:задан|назнач)|не (?:выполнять|делать) цдз/iu.test(value))return false
  return /(?:^|[^а-яё])цдз(?:$|[^а-яё])|(?:цифров\S*|электрон\S*)\s+(?:домашн\S*\s+)?задани/iu.test(value)
   || /(?:выполн|прой|пройти|реши|сдай)/iu.test(value)&&/(?:МЭШ|РЭШ|учи\.ру|https?:\/\/)/iu.test(value)&&/(?:тест|задани|работ)/iu.test(value)
   || /тренировочн\S*\s+работ/iu.test(value)&&/https?:\/\/\S+/iu.test(value)
 }
 if(explicit(task.familyOrigin?task.detail:task.meshText))return true
 return (Array.isArray(task.steps)?task.steps:[]).some(step=>step&&typeof step==='object'&&step.source?.kind==='teacher-file'
  &&step.source.certainty==='confirmed'&&typeof step.source.excerpt==='string'
  &&typeof step.source.evidence==='string'&&step.source.evidence.includes(step.source.excerpt)&&explicit(step.source.excerpt))
}
export function platformAssignmentErrors(task={}) {
 return (task.outputKind==='platform-result'||task.kind==='cdz')&&!hasAssignedPlatformWork(task)
  ? ['Цифровая сдача не назначена подтверждённым текстом учителя. Счётчики материалов и выбранный агентом вид карточки не создают обязанность и запрос результата.'] : []
}

export function rawMeshKind(description) {
  if (/(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(description)) return 'check'
  // A reference to notes in a notebook is a study source, not a written task.
  // @see ../docs/modules/synchronization/plan-generation.md#raw-mesh-stage
  const actionable = description.replace(/(?:см\.?|смотри(?:те)?)\s+записи\s+в\s+тетради/gi, '')
  if (/(?:доделать|закончить|выполнить)[\s\S]*(?:р\.?\s*т\.?|рабоч\S*\s+тетрад)/iu.test(actionable)) return 'written'
  if (/в\s+тетрад[ьи]|дописать|выписать|записать|письменно|\(\s*пис\s*\)/i.test(actionable)) return 'written'
  return 'check'
}
