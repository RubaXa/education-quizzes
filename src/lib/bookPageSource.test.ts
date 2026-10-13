import { describe, expect, it } from 'vitest'
import { readBookPageSource } from './bookPageSource'

const pages = Array.from({ length: 240 }, (_, index) => ({
  title: `Страница ${index + 1}`, url: `https://example.test/book/${index + 1}.png`,
  sourceType: 'textbook-page' as const, sourceSha256: 'edition-sha', pdfPage: index + 1,
}))
const manifest = { schemaVersion: 1, state: 'published-manifest', sourceSha256: 'edition-sha', pageCount: pages.length, pages }

describe('family book manifest read budget', () => {
  it('replaces a cold read of 240 page documents with one verified manifest', async () => {
    let oldReadDocuments = 0
    const old = await readBookPageSource({ manifestReady: false, expectedCount: pages.length, sourceSha256: 'edition-sha' }, {
      readManifest: async () => { throw new Error('old client must not request v2') },
      readLegacy: async () => { oldReadDocuments += pages.length; return pages },
    })
    let newReadDocuments = 0
    const current = await readBookPageSource({ manifestReady: true, expectedCount: pages.length, sourceSha256: 'edition-sha' }, {
      readManifest: async () => { newReadDocuments += 1; return manifest },
      readLegacy: async () => { newReadDocuments += pages.length; return pages },
    })
    expect(old.kind).toBe('legacy')
    expect(current).toEqual({ kind: 'manifest', links: pages })
    expect(oldReadDocuments).toBe(240)
    expect(newReadDocuments).toBe(1)
    expect((oldReadDocuments - newReadDocuments) / oldReadDocuments).toBeGreaterThanOrEqual(0.2)
    console.log(JSON.stringify({ scenario: 'family-book/cold-open/240-pages', metric: 'delivered-documents',
      baseline: oldReadDocuments, candidate: newReadDocuments,
      reductionPercent: Math.round((oldReadDocuments - newReadDocuments) / oldReadDocuments * 1000) / 10 }))
  })

  it('keeps v1 pages visible if the manifest is incomplete or unavailable', async () => {
    for (const readManifest of [async () => ({ ...manifest, pages: pages.slice(1) }), async () => { throw new Error('offline') }]) {
      let oldReads = 0
      const result = await readBookPageSource({ manifestReady: true, expectedCount: pages.length, sourceSha256: 'edition-sha' }, {
        readManifest, readLegacy: async () => { oldReads += 1; return pages },
      })
      expect(result).toEqual({ kind: 'legacy', value: pages })
      expect(oldReads).toBe(1)
    }
  })
})
