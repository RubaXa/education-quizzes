/** @see ../../docs/decisions/review-readability-repair-2026-10-31.md */
/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
/** Typed, bounded allowlist for learner-visible review graphics and disclosures.
 * @see ../../docs/shared/design/compact-review.md#data */
const text = (value, max = 900) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))
/** An authoring budget, never a substring or a smaller font in the renderer. */
export const reviewOverviewLimits = Object.freeze({title:80,confirmed:160,focus:160,bridge:160,question:160,total:420})
export function reviewOverviewErrors(feedback) {
  if (!feedback) return []
  const lengths=Object.fromEntries(['title','confirmed','focus','bridge','question'].map(key=>[key,typeof feedback[key]==='string'?feedback[key].trim().length:0]))
  const excess=Object.entries(lengths).filter(([key,length])=>length>reviewOverviewLimits[key]).map(([key])=>key)
  if(excess.length||Object.values(lengths).reduce((a,b)=>a+b,0)>reviewOverviewLimits.total)
    return [`Слишком много текста первого уровня${excess.length?`: ${excess.join(', ')}`:''}. Оставьте короткий вывод и один вопрос; полное пояснение перенесите в presentation.details без потери смысла.`]
  return []
}
export function reviewVisualValid(visual) {
  if (!text(visual?.label, 240)) return false
  if (visual.kind === 'facts') return keys(visual, ['kind','label','items']) && Array.isArray(visual.items) && visual.items.length > 0 && visual.items.length <= 3
    && visual.items.every(item => keys(item,['label','value']) && text(item.label,140) && text(item.value,180))
  if (visual.kind === 'annotation') return keys(visual,['kind','label','parts']) && Array.isArray(visual.parts) && visual.parts.length > 0 && visual.parts.length <= 30
    && visual.parts.every(part => keys(part,['text','mark']) && text(part.text,500) && (part.mark === undefined || ['focus','reference'].includes(part.mark)))
  if (visual.kind === 'timeline') return keys(visual,['kind','label','events']) && Array.isArray(visual.events) && visual.events.length > 0 && visual.events.length <= 3
    && visual.events.every(event => keys(event,['date','label']) && text(event.date,60) && text(event.label,180))
  if (visual.kind === 'comparison') return keys(visual,['kind','label','columns','rows']) && Array.isArray(visual.columns) && visual.columns.length >= 2 && visual.columns.length <= 4
    && visual.columns.every(value => text(value,100)) && Array.isArray(visual.rows) && visual.rows.length > 0 && visual.rows.length <= 5
    && visual.rows.every(row => keys(row,['cells']) && Array.isArray(row.cells) && row.cells.length === visual.columns.length && row.cells.every(value => text(value,240)))
  return false
}
export function reviewSupplementErrors(value) {
  if (value === undefined) return []
  if (!keys(value,['version','visual','details']) || value.version !== 1
    || value.visual !== undefined && !reviewVisualValid(value.visual)
    || value.details !== undefined && (!Array.isArray(value.details) || value.details.length > 20 || value.details.some(detail =>
      !keys(detail,['label','text','quotation','visual']) || !text(detail.label,160) || !text(detail.text,1800)
      || detail.quotation !== undefined && !text(detail.quotation,900)
      || detail.visual !== undefined && !reviewVisualValid(detail.visual)))) return ['Некорректный публичный формат разбора: нужны version 1, проверенные визуальные данные и безопасные пояснения.']
  return []
}
/** Deep-clone only the validated public representation. Private keys are never forwarded. */
export function projectReviewSupplement(value) {
  if (value === undefined || reviewSupplementErrors(value).length) return undefined
  return JSON.parse(JSON.stringify(value))
}
