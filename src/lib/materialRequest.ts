/** A tutor asks for context without inventing a teacher requirement or a grade.
 * @see ../../docs/modules/materials/material-clarification.md */
export type MaterialRequest = {
  id: string; state: 'open' | 'resolved'; question: string; photoPrompt: string;
  resolvedTopic?: string; uploadIds?: string[];
}
export type SourceAnalysis = {
  requestId: string; topic: string | null; observed: string; quality: string;
  limitation: string; nextStep: string;
  evidence: { uploadId: string; location: string; text: string }[];
}
type RequestTask = { materialRequest?: MaterialRequest; testToken?: string; assessmentIntent?: { state: string } }
type SourceReview = { purpose?: string; sourceAnalysis?: SourceAnalysis; status?: unknown; workCoverage?: unknown; assessmentBasis?: unknown; uploadIds?: string[] }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length >= 8
export function materialRequestErrors(task: RequestTask): string[] {
  const r = task.materialRequest
  if (!r) return []
  if (!/^[a-z0-9-]{3,64}$/.test(r.id) || !['open','resolved'].includes(r.state)
    || !text(r.question) || !text(r.photoPrompt)) return ['Запрос материала требует ID, вопрос, вид снимка и состояние.']
  if (r.state === 'open' && task.testToken) return ['До привязки теста разрешите запрос материала и сохраните источники.']
  if (r.state === 'open' && !['needs-topic','needs-review'].includes(task.assessmentIntent?.state ?? '')) return ['Открытый запрос материала требует незавершённого уточнения задания.']
  if (r.state === 'resolved' && (!r.resolvedTopic?.trim() || !r.uploadIds?.length)) return ['Разрешённый запрос должен сохранить тему и исходные снимки.']
  return []
}
export function openMaterialRequest(task: RequestTask): MaterialRequest | undefined {
  return task.materialRequest?.state === 'open' && !materialRequestErrors(task).length ? task.materialRequest : undefined
}
export function sourceReviewErrors(review: SourceReview, task: RequestTask): string[] {
  const r = openMaterialRequest(task), a = review.sourceAnalysis
  if (review.purpose !== 'source-material') return r ? ['Фото запрошенного материала сначала проходит source-material, без оценки выполнения ДЗ.'] : []
  if (!r || !a || a.requestId !== r.id || review.status !== undefined || review.workCoverage !== undefined || review.assessmentBasis !== undefined
    || !(a.topic === null || typeof a.topic === 'string' && Boolean(a.topic.trim())) || ![a.observed,a.quality,a.limitation,a.nextStep].every(text)
    || !a.evidence?.length || !a.evidence.every(e => review.uploadIds?.includes(e.uploadId) && text(e.location) && text(e.text))) {
    return ['Разбор источника требует вопрос, наблюдения на снимках, границы вывода и следующий шаг; он не выставляет статус выполнения ДЗ.']
  }
  return []
}
export function materialRequestView(task: RequestTask, uploads: {status:string}[], review?: SourceReview) {
  const request = openMaterialRequest(task)
  if (!request) return undefined
  if (uploads.some(u => ['requested','awaiting-upload','uploaded'].includes(u.status))) return { phase:'uploading', label:'Материал загружается', detail:'Дождись завершения загрузки файла.' }
  if (uploads.some(u => u.status === 'pending')) return { phase:'received', label:'Материал получен', detail:'Материал сохранён. Уточним тему при следующей синхронизации.' }
  const a = review?.purpose === 'source-material' && review.sourceAnalysis?.requestId === request.id ? review.sourceAnalysis : undefined
  if (a) return { phase:a.topic ? 'identified' : 'waiting', label:a.topic ? 'Тема уточнена' : 'Нужно уточнить материал', detail:a.nextStep }
  return { phase:'waiting', label:'Нужен материал для уточнения', detail:request.question }
}

/** A source receipt is an audited processing result, without a homework verdict. */
export function hasSourceReceipt(review?: SourceReview): boolean {
  return review?.purpose === 'source-material' && Boolean(review.sourceAnalysis?.requestId) && review.status === undefined
}
