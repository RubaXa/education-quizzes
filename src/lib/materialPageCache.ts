import type { DayMaterialLink } from './dayStore'

/** Parent book reader cache. Access is still checked by the live family book
 * binding before this cache is used; the key includes that binding's revision.
 * Keep this database separate from quiz drafts so cache upgrades cannot block
 * a pupil's unfinished test.
 * @see ../../docs/shared/data/revisions.md#матрица-чтения */
const databaseName = 'education-material-cache-v1'
const storeName = 'publishedBooks'

type CachedBook = { key: string; links: DayMaterialLink[] }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Локальный кеш учебников занят другой вкладкой.'))
  })
}

export function completeMaterialPages(value: unknown, expectedCount: number, sourceSha256: string): value is DayMaterialLink[] {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || !sourceSha256) return false
  return Array.isArray(value) && value.length === expectedCount
    && value.every((link) => link && typeof link === 'object'
      && link.sourceType === 'textbook-page' && typeof link.title === 'string'
      && typeof link.url === 'string' && link.url.startsWith('https://')
      && link.sourceSha256 === sourceSha256
      && Number.isInteger(link.pdfPage) && link.pdfPage > 0 && link.pdfPage <= expectedCount)
    && new Set(value.map((link) => link.pdfPage)).size === expectedCount
}

/** A family-scoped v2 bundle is accepted only with the exact binding hash and
 * a complete page sequence. Missing/old bundles fall back to v1 page rows.
 * @see ../../docs/modules/materials/family-library.md#full-book-reader */
export function verifiedBookManifest(value: unknown, expectedCount: number, sourceSha256: string): DayMaterialLink[] | null {
  if (!value || typeof value !== 'object') return null
  const manifest = value as { schemaVersion?: unknown; state?: unknown; sourceSha256?: unknown; pageCount?: unknown; pages?: unknown }
  return manifest.schemaVersion === 1 && manifest.state === 'published-manifest'
    && manifest.sourceSha256 === sourceSha256 && manifest.pageCount === expectedCount
    && completeMaterialPages(manifest.pages, expectedCount, sourceSha256) ? manifest.pages : null
}

export async function readMaterialPages(key: string, expectedCount: number, sourceSha256: string): Promise<DayMaterialLink[] | null> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(key)
    let record: CachedBook | undefined
    request.onsuccess = () => { record = request.result as CachedBook | undefined }
    tx.oncomplete = () => { db.close(); resolve(completeMaterialPages(record?.links, expectedCount, sourceSha256) ? record!.links : null) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

export async function writeMaterialPages(key: string, links: DayMaterialLink[]): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put({ key, links } satisfies CachedBook)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}
