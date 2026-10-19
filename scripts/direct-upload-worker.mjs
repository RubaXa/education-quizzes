/**
 * Compatibility entrypoint. Upload work is owned by the single
 * educationEvents consumer; this script never creates source listeners.
 * @see ../docs/product/materials.md
 * @see ../docs/services/web-app/local-first-sync.md
 * @see ../docs/services/upload-worker/README.md
 * @see ../docs/shared/media-storage.md
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createEducationFirestore } from '../packages/education-runtime/firestore.mjs'
import { createUploadReconciliationProducer } from '../packages/education-runtime/upload-broker.mjs'

export { createUploadBroker, createUploadBrokerHandlers, createUploadReconciliationProducer } from '../packages/education-runtime/upload-broker.mjs'

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const [command] = args
  const write = dependencies.write ?? process.stdout.write.bind(process.stdout)
  if (!command || command === 'status') {
    write(`${JSON.stringify({ component: 'upload-broker', mode: 'queue-handler-only', standaloneWorker: false, sourceSubscriptions: 0 })}\n`)
    return 0
  }
  if (command === 'reconcile-once' && args.length === 1) {
    let db = dependencies.db
    let ownsDb = false
    try {
      if (!db) {
        const root = dependencies.root ?? process.cwd()
        db = (dependencies.dbFactory ?? createEducationFirestore)({ projectId: 'education-9d7c6', cwd: root })
        ownsDb = true
      }
      const reconciler = createUploadReconciliationProducer({ db,
        ...(dependencies.reconciliation ?? {}), ...(dependencies.reconciliationLogger ? { logger: dependencies.reconciliationLogger } : {}) })
      const counts = await reconciler.runOne()
      write(`${JSON.stringify({ component: 'upload-broker', mode: 'bounded-reconciliation', ...counts })}\n`)
      return 0
    } catch (error) {
      write(`${JSON.stringify({ component: 'upload-broker', mode: 'bounded-reconciliation', safeCode: error?.safeCode ?? 'reconciliation_failed' })}\n`)
      return 1
    } finally {
      if (ownsDb) { try { await db?.terminate?.() } catch { /* preserve the command result */ } }
    }
  }
  write(`${JSON.stringify({ code: 'usage', usage: 'node scripts/direct-upload-worker.mjs status | reconcile-once' })}\n`)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main()
}
