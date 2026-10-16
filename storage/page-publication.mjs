/** Addressed page publication preserves unrelated catalogue records.
 * @see ../docs/modules/materials/materials.md#page-publication */
export function selectPublicationPages(entries, pageId) {
  if (pageId === undefined) return entries
  const selected = entries.filter((entry) => entry.id === pageId)
  if (selected.length !== 1) throw new Error(`Не найдена единственная подготовленная страница ${pageId}. Сначала задайте taskPages и prepare-pages.`)
  return selected
}

export function materialPageDocument(entry, url) {
  return { bookId: entry.bookId, title: entry.title, pdfPage: entry.pdfPage,
    printedPage: entry.printedPage, sourceSha256: entry.sourceSha256,
    imageSha256: entry.imageSha256, diskPath: entry.diskPath, url, state: 'published' }
}

export function needsPageWrite(current, desired) {
  return !current || Object.entries(desired).some(([key, value]) => current[key] !== value)
}
