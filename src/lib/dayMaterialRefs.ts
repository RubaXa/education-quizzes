import type { DayPageData, DayMaterialLink } from './dayStore'

/** Published dayPages already carry verified textbook links. Fetch only refs
 * missing from that projection; legacy pages and teacher attachments still use
 * their family bookPages documents.
 * @see ../../docs/modules/materials/materials.md#day-page-embedded-links */
export function unresolvedMaterialPageRefs(page: Pick<DayPageData, 'taskPageRefs' | 'materialLinks'>): string[] {
  const unresolved = new Set<string>()
  for (const [taskId, refs] of Object.entries(page.taskPageRefs ?? {})) {
    const links = page.materialLinks?.[taskId] ?? []
    for (const ref of refs) if (!links.some((link) => matchesPublishedPage(ref, link))) unresolved.add(ref)
  }
  return [...unresolved]
}

/** @see ../../docs/modules/materials/materials.md#adjacent-pages */
export function groupAdjacentMaterialPages(links: DayMaterialLink[]): DayMaterialLink[][] {
  const groups: DayMaterialLink[][] = []
  for (const link of links) {
    const previous = groups.at(-1)?.at(-1)
    const previousBook = previous?.sourceRef?.match(/^([^#]+)#pdf-\d+$/)?.[1]
    const book = link.sourceRef?.match(/^([^#]+)#pdf-\d+$/)?.[1]
    const contiguous = link.sourceType === 'textbook-page' && previous?.sourceType === 'textbook-page'
      && book && book === previousBook && Number.isInteger(link.pdfPage) && Number.isInteger(previous.pdfPage)
      && link.pdfPage === previous.pdfPage! + 1
    const sameTeacherSheet = link.sourceType === 'teacher-attachment' && previous?.sourceType === 'teacher-attachment'
      && link.title === previous.title
    if (contiguous || sameTeacherSheet) groups[groups.length - 1].push(link)
    else groups.push([link])
  }
  return groups
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
