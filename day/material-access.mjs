/** A shared page is not by itself a family grant. Textbooks need the family's
 * own binding; a teacher file needs an assigned teacher attachment in this day.
 * @see ../docs/shared/data/firestore.md#edges */
export function materialGrantError({ ref, catalog, shared, binding, teacherAssigned }) {
  if (!shared || shared.state !== 'published' || typeof shared.url !== 'string' || !shared.url.startsWith('https://')) {
    return `Общая страница ${ref} не опубликована.`
  }
  if (catalog?.role === 'student-textbook') {
    if (!['confirmed', 'provisional'].includes(binding?.status)) return `У семьи нет подтверждённой связи с учебником ${catalog.bookId ?? shared.bookId}.`
    const catalogSha = catalog.sourceSha256
    const boundSha = binding.catalogSha256 ?? binding.sourceSha256
    if (!catalogSha || boundSha !== catalogSha || shared.sourceSha256 !== catalogSha) return `Издание семейного учебника ${catalog.bookId ?? shared.bookId} не совпадает с общей страницей.`
    return null
  }
  if (teacherAssigned) return null
  return `Для материала ${ref} не подтверждено семейное право или назначение учителя.`
}
