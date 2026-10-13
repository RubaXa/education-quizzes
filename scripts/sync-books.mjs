import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { indexedBooks } from '../storage/textbook-catalog.mjs'
import { projectPublishedBookToFamily } from '../storage/family-book-projection.mjs'

/** One idempotent operator pass for registered PDFs and every family binding.
 * @see ../docs/product/education-pipeline.md#textbook-sync
 */
const root = resolve('..')
const credentials = resolve('.local/adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = credentials
if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
  throw new Error('Нужен локальный вход Firebase (.local/adc.json).')
}

function run(command, args, cwd = resolve('.')) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env })
}

async function main() {
run('python3', ['tools/textbook_index.py', 'build-all'], root)
run('python3', ['tools/textbook_index.py', 'audit'], root)

initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const indexed = indexedBooks()

async function staleCatalog() {
  const stale = []
  for (const { book, index } of indexed) {
    const ref = db.doc(`materialBooks/${book.id}`)
    const document = await ref.get()
    const data = document.data()
    if (data?.sourceSha256 !== index.source_sha256
      || data?.pdfPageCount !== index.pdf_page_count) { stale.push(book.id); continue }
    if (data.catalogIndexSha256 === index.source_sha256
      && data.catalogPageCount === index.pdf_page_count && data.catalogCompletedAt) continue
    // Legacy catalog: verify once, then write a completion marker after the audit.
    const count = await ref.collection('pages').count().get()
    const endpoints = await Promise.all([1, index.pdf_page_count].map((page) => ref.collection('pages').doc(String(page)).get()))
    if (count.data().count !== index.pdf_page_count || endpoints.some((page) =>
      page.data()?.sourceSha256 !== index.source_sha256 || typeof page.data()?.searchText !== 'string')) {
      stale.push(book.id); continue
    }
    await ref.set({ catalogIndexSha256: index.source_sha256,
      catalogPageCount: index.pdf_page_count, catalogCompletedAt: new Date() }, { merge: true })
  }
  return stale
}

const stale = await staleCatalog()
if (stale.length) {
  console.log(JSON.stringify({ stage: 'shared-catalog', action: 'rebuild', books: stale }))
  run('node', ['scripts/storage.mjs', 'sync-catalog'])
  const remaining = await staleCatalog()
  if (remaining.length) throw new Error(`Общий каталог не готов: ${remaining.join(', ')}`)
}

const bindings = (await db.collectionGroup('books').get()).docs.filter((document) => {
  const child = document.ref.parent.parent
  const family = child?.parent.parent
  return child && family && family.parent.id === 'families'
    && ['confirmed', 'provisional'].includes(document.data().status)
})
async function projectAll() {
  const pending = []
  let pages = 0, projected = 0
  for (const binding of bindings) {
    const result = await projectPublishedBookToFamily(db, binding.ref,
      { verifyCount: process.argv.includes('--verify-family-pages') })
    if (result.status === 'pending') pending.push({ path: binding.ref.path, reason: result.reason })
    else { pages += result.pages; projected += result.projected }
  }
  return { pending, pages, projected }
}

let state = await projectAll()
if (state.pending.length) {
  console.log(JSON.stringify({ stage: 'page-images', action: 'publish', books: state.pending }))
  run('node', ['scripts/storage.mjs', 'sync-family-pages'])
  state = await projectAll()
}
if (state.pending.length) throw new Error(`Страницы не готовы: ${JSON.stringify(state.pending)}`)

const uploads = await db.collectionGroup('bookUploads').get()
const boundPaths = new Set(bindings.map((binding) => binding.ref.path))
const unresolved = uploads.docs.filter((document) => document.data().status !== 'linked'
  || !document.data().bookId
  || !boundPaths.has(`${document.ref.parent.parent?.path}/books/${document.data().bookId}`))
console.log(JSON.stringify({ complete: unresolved.length === 0, indexedBooks: indexed.length,
  familyBindings: bindings.length, familyPages: state.pages, newlyProjected: state.projected,
  unresolvedUploads: unresolved.map((document) => ({ path: document.ref.path, status: document.data().status })) }, null, 2))
if (unresolved.length) process.exitCode = 1
}

await main().catch((error) => {
  const quota = error?.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(error?.message ?? '')
  console.error(JSON.stringify({ complete: false, reason: quota
    ? 'Исчерпан лимит Firestore. Индексы PDF сохранены; повторите серверную сверку после восстановления квоты.'
    : error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
