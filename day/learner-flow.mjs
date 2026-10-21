/** @see ../docs/decisions/scoped-learner-flow-2026-10-21.md */
/** Public process support for a verified fragment; never a private key.
 * @see ../docs/modules/reviews/subject-aware-guidance.md#learner-flow */
export function learnerFlowErrors(task, pageIds) {
  const flow = task?.learnerFlow
  if (flow == null) return []
  const text = (s) => typeof s === 'string' && s.trim().length > 0
  const only = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k))
  if (!only(flow, ['version', 'scope', 'meshExcerpt', 'boundary', 'source', 'goal', 'stages'])
    || flow.version !== 1 || !text(flow.scope) || !text(flow.goal) || !text(flow.boundary)
    || !text(flow.meshExcerpt) || !task.meshText?.includes(flow.meshExcerpt)
    || !only(flow.source, ['pageId', 'label', 'excerpt']) || !text(flow.source.pageId)
    || !text(flow.source.label) || !text(flow.source.excerpt)
    || pageIds && !pageIds.includes(flow.source.pageId)
    || !Array.isArray(flow.stages) || flow.stages.length < 2 || flow.stages.length > 8) {
    return ['Учебная помощь требует точную область МЭШ, проверенный источник и явную границу.']
  }
  const ids = new Set()
  for (const stage of flow.stages) {
    if (!only(stage, ['id', 'title', 'prompt', 'hint', 'frame', 'sourceLabel'])
      || !/^[a-z][a-z0-9-]*$/.test(stage.id ?? '') || ids.has(stage.id)
      || !['title', 'prompt', 'hint', 'frame', 'sourceLabel'].every(k => text(stage[k]))) {
      return ['Этап помощи неполон или содержит закрытые поля; ключи и ответы здесь запрещены.']
    }
    ids.add(stage.id)
  }
  return []
}
