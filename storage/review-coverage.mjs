/**
 * A photo has one upload placement but may prove several tasks on the same day.
 * Coverage is asserted by the reviewer after reading the original, never inferred
 * from the button used to upload it.
 * @see ../docs/product/storage-privacy.md#multi-task-photo
 */
export function reviewCoverage(batch) {
  if (!Array.isArray(batch.reviews) || !batch.reviews.length || batch.taskId !== undefined) {
    throw new Error('Для фото с уточнённой привязкой нужны отдельные разборы заданий.')
  }
  if (!Array.isArray(batch.uploadIds) || !batch.uploadIds.length || new Set(batch.uploadIds).size !== batch.uploadIds.length) {
    throw new Error('Укажите уникальные фотографии общего разбора.')
  }
  const uploads = new Set(batch.uploadIds)
  const byUpload = new Map(batch.uploadIds.map((id) => [id, new Set()]))
  const taskIds = new Set()
  for (const review of batch.reviews) {
    if (!review || !/^[a-z0-9-]+$/.test(review.taskId ?? '') || taskIds.has(review.taskId)
      || !Array.isArray(review.uploadIds) || !review.uploadIds.length
      || new Set(review.uploadIds).size !== review.uploadIds.length
      || review.uploadIds.some((id) => !uploads.has(id))) {
      throw new Error('Каждому номеру нужен уникальный taskId и точные ID его фотографий.')
    }
    taskIds.add(review.taskId)
    for (const id of review.uploadIds) byUpload.get(id).add(review.taskId)
  }
  if (!Array.isArray(batch.photoCoverage) || batch.photoCoverage.length !== uploads.size) {
    throw new Error('Для каждой фотографии опишите все видимые на ней решения.')
  }
  const coverage = new Map()
  for (const item of batch.photoCoverage) {
    if (!item || !uploads.has(item.uploadId) || coverage.has(item.uploadId)
      || !Array.isArray(item.taskIds) || !item.taskIds.length
      || new Set(item.taskIds).size !== item.taskIds.length || typeof item.observed !== 'string' || !item.observed.trim()) {
      throw new Error('Покрытие фотографии неполное или повторяется.')
    }
    const expected = byUpload.get(item.uploadId)
    if (expected.size !== item.taskIds.length || item.taskIds.some((id) => !expected.has(id))) {
      throw new Error('Номера на фотографии не совпадают с отдельными разборами.')
    }
    coverage.set(item.uploadId, { taskIds: [...item.taskIds], observed: item.observed.trim() })
  }
  return coverage
}
