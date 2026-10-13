import type { DayPageData, DayMaterialLink } from './dayStore'

/** Published dayPages already carry verified textbook links. Fetch only refs
 * missing from that projection; legacy pages and teacher attachments still use
 * their family bookPages documents.
 * @see ../../docs/product/materials.md#day-page-embedded-links */
export function unresolvedMaterialPageRefs(page: Pick<DayPageData, 'taskPageRefs' | 'materialLinks'>): string[] {
  const unresolved = new Set<string>()
  for (const [taskId, refs] of Object.entries(page.taskPageRefs ?? {})) {
    const links = page.materialLinks?.[taskId] ?? []
    for (const ref of refs) if (!links.some((link) => matchesPublishedPage(ref, link))) unresolved.add(ref)
  }
  return [...unresolved]
}

function matchesPublishedPage(ref: string, link: DayMaterialLink): boolean {
  const match = /^([a-z0-9-]+)#([1-9]\d*)$/.exec(ref)
  if (!match) return false
  const pdfPage = Number(match[2])
  return link.sourceType === 'textbook-page'
    && link.sourceRef === `${match[1]}#pdf-${String(pdfPage).padStart(4, '0')}`
    && link.pdfPage === pdfPage
    && typeof link.sourceSha256 === 'string' && link.sourceSha256.length > 0
    && typeof link.url === 'string' && link.url.startsWith('https://')
}
