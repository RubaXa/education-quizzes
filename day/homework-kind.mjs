/** One classification contract for the operator pipeline and the Firebase client.
 * @see ../docs/modules/synchronization/plan-generation.md#raw-mesh-stage */
export function isExplicitCdzTask(task) {
  const source = task.meshText?.trim()
  return task.kind === 'check' && (source
    ? /(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(source)
    : task.id?.endsWith('-cdz') || /(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(task.title ?? ''))
}

export function rawMeshKind(description) {
  if (/(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(description)) return 'check'
  // A reference to notes in a notebook is a study source, not a written task.
  // @see ../docs/modules/synchronization/plan-generation.md#raw-mesh-stage
  const actionable = description.replace(/(?:см\.?|смотри(?:те)?)\s+записи\s+в\s+тетради/gi, '')
  if (/в\s+тетрад[ьи]|дописать|выписать|записать|письменно|\(\s*пис\s*\)/i.test(actionable)) return 'written'
  return 'check'
}
