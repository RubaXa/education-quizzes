import { rawMeshKind } from './homework-kind.mjs'

/** Explicit publication exception for an exact MESH entry whose material or
 * interpretation is still unresolved. It never authorizes enrichment.
 * @see ../docs/modules/synchronization/plan-generation.md#source-only-publication
 * @see ../docs/decisions/source-only-mesh-publication-2026-10-20.md
 */
export function sourceOnlyPublicationErrors(task) {
  if (task?.sourceOnly !== true) return ['Для режима точной записи МЭШ явно укажите sourceOnly: true.']
  if (!task.id?.startsWith('mesh-') || !task.meshText?.trim()
    || task.instructionStatus?.state !== 'needs-review'
    || task.detail !== task.meshText || task.kind !== rawMeshKind(task.meshText)) {
    return ['Режим точной записи требует исходный ID и текст МЭШ без пересказа и с needs-review.']
  }
  if (!['textbook-page-needed', 'teacher-attachment-needed'].includes(task.materialStatus?.state)
    || !task.materialStatus?.message?.trim()) {
    return ['Для source-only публикации укажите, какой учебник или файл ещё ожидает сверки.']
  }
  if ((task.cardPolicyVersion != null && task.cardPolicyVersion !== 1)
    || (task.mathRoutePolicyVersion != null && task.mathRoutePolicyVersion !== 2)) {
    return ['В source-only разрешены только штатные версии политики без созданного адаптера.']
  }
  const enriched = ['steps', 'submission', 'parentGuide', 'problems', 'practiceVariants', 'cardPattern',
    'outputKind', 'testToken', 'testSlug', 'requiredPoints', 'assessmentIntent', 'sourceInventory']
    .some((key) => task[key] != null && (!Array.isArray(task[key]) || task[key].length > 0))
  if (enriched) return ['Режим точной записи не допускает добавленных шагов, решений или тестов.']
  return []
}

export function canPublishSourceOnly(task) {
  return task?.sourceOnly === true && sourceOnlyPublicationErrors(task).length === 0
}

/** Keep an unresolved source from blocking unrelated, ready assignments only
 * when that task is explicitly restricted to its exact MESH text.
 */
export function taskMaterialPublicationError(task, { hasPages = false, hasTeacherFile = false } = {}) {
  const state = task?.materialStatus?.state
  const sourceOnly = canPublishSourceOnly(task) && ['textbook-page-needed', 'teacher-attachment-needed'].includes(state)
  if (state === 'teacher-attachment-needed' && !sourceOnly) {
    return `Файлы урока ещё не сопоставлены с отдельным заданием ${task.id}; день не опубликован.`
  }
  if ((state === 'textbook-page-needed' || (task?.id?.startsWith('mesh-') && !hasPages && !hasTeacherFile
    && !['no-textbook', 'text-absent-from-textbook'].includes(state))) && !sourceOnly) {
    return `Источник ${task.id} ещё не сверён с учебником. Укажите точные страницы или причину отсутствия учебника; день не опубликован.`
  }
  if (state === 'textbook-page-linked' && !hasPages) return `Для ${task.id} нет привязки к индексированной странице учебника.`
  return null
}
