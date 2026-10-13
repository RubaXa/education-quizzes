import type { DayMaterialLink } from './dayStore'
import { verifiedBookManifest } from './materialPageCache'

/** A v2 family manifest is one document; v1 page rows remain a safe fallback.
 * The caller's live family book binding decides whether the manifest may be read.
 * @see ../../docs/product/family-library.md#full-book-reader */
export async function readBookPageSource<T>(input: {
  manifestReady: boolean
  expectedCount: number
  sourceSha256: string
}, source: {
  readManifest: () => Promise<unknown>
  readLegacy: () => Promise<T>
}): Promise<{ kind: 'manifest'; links: DayMaterialLink[] } | { kind: 'legacy'; value: T }> {
  if (input.manifestReady) {
    try {
      const links = verifiedBookManifest(await source.readManifest(), input.expectedCount, input.sourceSha256)
      if (links) return { kind: 'manifest', links }
    } catch { /* A missing or unreadable v2 document must not hide v1 pages. */ }
  }
  return { kind: 'legacy', value: await source.readLegacy() }
}
