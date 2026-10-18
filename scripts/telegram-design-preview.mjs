import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createDomainEvent } from '../packages/telegram-notifications/domain/events.mjs'
import { resolveProbeTarget } from '../packages/telegram-notifications/operations/probe-target.mjs'
import { createRuntime } from '../packages/telegram-notifications/adapters/runtime.mjs'
import { createFirestoreProbeRecipientResolver } from '../packages/telegram-notifications/adapters/probe-recipient-firestore.mjs'
import { ProbeNotificationService } from '../packages/telegram-notifications/application/probe-notifications.mjs'
import { renderNotificationDigestParts } from '../packages/telegram-notifications/domain/renderer.mjs'
import { NOTIFICATION_EXAMPLES } from '../packages/education-presentation/notification.mjs'

/** @see ../docs/shared/design/telegram.md#приёмка @see ../docs/services/telegram-bot/operations.md */
export function parseDesignPreviewArgs(args) {
  const result = { apply: false, receiptOnly: false, targetDigest: null, runId: null }
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--receipt-only' && !result.receiptOnly) { result.receiptOnly = true; continue }
    if (flag === '--apply' && !result.apply) { result.apply = true; continue }
    const key = flag === '--target-digest' ? 'targetDigest' : flag === '--run-id' ? 'runId' : null
    if (!key || result[key] || !args[index + 1]) throw new Error('preview_usage')
    result[key] = args[++index]
  }
  if (result.apply && result.receiptOnly) throw new Error('preview_usage')
  if (!/^[a-f0-9]{16}$/.test(result.targetDigest ?? '') || !/^[A-Za-z0-9_-]{1,80}$/.test(result.runId ?? '')) throw new Error('preview_usage')
  return result
}

/** Operator-only design examples reuse technical event routing and the durable production delivery path. */
export async function main(args = process.argv.slice(2), dependencies = {}) {
  const write = dependencies.write ?? process.stdout.write.bind(process.stdout)
  let db = null
  let stage = 'arguments'
  const emit = (value) => write(`${JSON.stringify(value)}\n`)
  try {
    const options = parseDesignPreviewArgs(args)
    const env = dependencies.env ?? process.env
    const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID
    if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId ?? '')) throw new Error('preview_project_unavailable')
    if (!env.AGI_EDU_BOT) throw new Error('preview_token_unavailable')
    const factory = dependencies.dbFactory ?? (await import('./lib/admin-firebase.mjs')).operatorFirestore
    db = dependencies.db ?? factory({ cwd: dependencies.root ?? process.cwd(), projectId })
    stage = 'recipient'
    const target = await (dependencies.resolveTarget ?? resolveProbeTarget)(db, options.targetDigest)
    if (!target) throw new Error('preview_recipient_unavailable')
    const digest = createHash('sha256').update(options.runId).digest('hex')
    const inputEvent = { source: 'firestore', eventType: 'technical.probe', familyId: target.familyId,
      childId: target.childId, scopeKey: `design-preview:${digest}`, sourceEventKey: `design-preview:${digest}`,
      sourceRevision: 'telegram-design-v1', privacyClass: 'family-summary', fields: {} }
    if (options.receiptOnly) {
      stage = 'receipt'
      const event = createDomainEvent({ ...inputEvent, detectedAt: new Date().toISOString() })
      const jobId = `${event.eventId}_${target.linkId}`
      const snapshot = await db.doc(`telegramNotificationOutbox/${jobId}`).get()
      const row = snapshot.exists ? snapshot.data() : null
      emit({ schemaVersion: 1, status: 'diagnostic', runId: options.runId, state: row?.state ?? 'absent',
        messageVersion: row?.messageVersion ?? null, parts: row?.messageParts?.length ?? 0, receiptParts: row?.partReceipts?.length ?? 0,
        formats: [...new Set((row?.partReceipts ?? []).map((part) => part.format).filter(Boolean))], writes: 0, sends: 0 })
      return 0
    }
    stage = 'templates'
    const template = NOTIFICATION_EXAMPLES.find((sample) => sample.event.eventType === 'review.changed')
    if (!template) throw new Error('preview_examples_unavailable')
    const examples = [
      { title: '№3 · Шестьдесят горшков', status: 'verified' },
      { title: '№1 · Книги на полках', status: 'needs-fix' },
      { title: '№5 · Периметр прямоугольника', status: 'verified' },
    ]
    const digestEvents = examples.map((fields) => ({ ...template.event,
      fields: { childName: 'Ученик А', subject: 'Математика', ...fields } }))
    const parts = renderNotificationDigestParts(digestEvents, 'family', { demo: true,
      action: { label: 'Открыть UI Kit', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit' } })
    if (parts.length !== 1) throw new Error('preview_examples_unavailable')
    if (!options.apply) { emit({ schemaVersion: 1, status: 'ready', runId: options.runId, examples: examples.length, parts: parts.length, writes: 0, sends: 0 }); return 0 }
    stage = 'runtime'
    const runtime = dependencies.runtime ?? createRuntime({ token: env.AGI_EDU_BOT, projectId, instanceId: `design-preview-${process.pid}` }, { firestore: db })
    const resolver = dependencies.recipientResolver ?? createFirestoreProbeRecipientResolver(db)
    const service = dependencies.previewService ?? new ProbeNotificationService({ eventLedger: runtime.adapters.eventLedger,
      recipientResolver: resolver, renderer: () => parts })
    stage = 'enqueue'
    const queued = await service.accept(inputEvent, { targetDigest: options.targetDigest })
    const readReceipt = dependencies.readReceipt ?? (async (jobId) => {
      const snap = await db.doc(`telegramNotificationOutbox/${jobId}`).get()
      if (!snap.exists) return null
      const row = snap.data()
      return { state: row.state, partReceipts: row.partReceipts, safeErrorCode: row.safeErrorCode }
    })
    stage = 'receipt'
    let receipt = await readReceipt(queued.jobId)
    if (receipt?.state !== 'sent') {
      stage = 'delivery'
      await runtime.notificationService.runOne({ jobId: queued.jobId, skipRecovery: true })
      receipt = await readReceipt(queued.jobId)
    }
    const receipts = receipt?.partReceipts ?? []
    const sent = receipt?.state === 'sent' && receipts.length === parts.length && receipts.every((item) => Number.isSafeInteger(item?.messageId))
    emit({ schemaVersion: 1, status: sent ? 'sent' : 'incomplete', runId: options.runId,
      examples: examples.length, parts: parts.length, receiptParts: receipts.length,
      state: receipt?.state ?? 'missing', formats: [...new Set(receipts.map((item) => item.format).filter(Boolean))] })
    return sent ? 0 : 1
  } catch (error) {
    const allowed = new Set(['preview_usage', 'preview_project_unavailable', 'preview_token_unavailable', 'preview_recipient_unavailable', 'preview_examples_unavailable'])
    const nestedArray = /nested arrays|array.*array/i.test(error?.message ?? '')
    emit({ schemaVersion: 1, status: 'failed', stage, code: allowed.has(error.message) ? error.message : nestedArray ? 'preview_nested_arrays_rejected' : 'preview_failed' })
    return 1
  } finally {
    if (db && !dependencies.keepOpen) { try { await db.terminate?.() } catch { /* no secret diagnostics */ } }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
