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
  const result = { apply: false, receiptOnly: false, historyDemo: false, targetDigest: null, runId: null }
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--receipt-only' && !result.receiptOnly) { result.receiptOnly = true; continue }
    if (flag === '--apply' && !result.apply) { result.apply = true; continue }
    if (flag === '--history-demo' && !result.historyDemo) { result.historyDemo = true; continue }
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
    const historyReplyEvent = options.historyDemo ? makeHistoryReplyLedgerEvent(inputEvent) : null
    const getJobId = (event) => `${createDomainEvent({ ...event, detectedAt: new Date().toISOString() }).eventId}_${target.linkId}`
    const readReceipt = dependencies.readReceipt ?? (async (jobId) => {
      const snap = await db.doc(`telegramNotificationOutbox/${jobId}`).get()
      if (!snap.exists) return null
      const row = snap.data()
      return { state: row.state, messageVersion: row.messageVersion, messageParts: row.messageParts,
        partReceipts: row.partReceipts, safeErrorCode: row.safeErrorCode }
    })
    if (options.receiptOnly) {
      stage = 'receipt'
      const receiptEvents = [inputEvent, ...(historyReplyEvent ? [historyReplyEvent] : [])]
      const rows = await Promise.all(receiptEvents.map(async (event) => {
        let row
        if (!options.historyDemo) {
          const snapshot = await db.doc(`telegramNotificationOutbox/${getJobId(event)}`).get()
          row = snapshot.exists ? snapshot.data() : null
        } else row = await readReceipt(getJobId(event))
        const receipts = row?.partReceipts ?? []
        return { state: row?.state ?? 'absent', messageVersion: row?.messageVersion ?? null,
          parts: row?.messageParts?.length ?? 0, receiptParts: receipts.length,
          formats: [...new Set(receipts.map((part) => part.format).filter(Boolean))] }
      }))
      emit({ schemaVersion: 1, status: 'diagnostic', runId: options.runId,
        ...(options.historyDemo ? { historyDemo: true, first: rows[0], reply: rows[1] } : rows[0]), writes: 0, sends: 0 })
      return 0
    }
    stage = 'templates'
    let examples = []
    let technicalParts = null
    let historyReplyDisplayParts = null
    let parts
    if (options.historyDemo) {
      technicalParts = withoutWorkBindings(renderNotificationDigestParts(makeHistoryDigestEvents(), 'family', { demo: true }))
      historyReplyDisplayParts = withoutWorkBindings(renderNotificationDigestParts([makeHistoryReplyDisplayEvent()], 'family', { demo: true }))
      parts = technicalParts
    } else {
      const template = NOTIFICATION_EXAMPLES.find((sample) => sample.event.eventType === 'review.changed')
      if (!template) throw new Error('preview_examples_unavailable')
      examples = [
        { title: '№3 · Шестьдесят горшков', status: 'verified' },
        { title: '№1 · Книги на полках', status: 'needs-fix' },
        { title: '№5 · Периметр прямоугольника', status: 'verified' },
      ]
      const digestEvents = examples.map((fields) => ({ ...template.event,
        fields: { childName: 'Ученик А', subject: 'Математика', ...fields } }))
      parts = renderNotificationDigestParts(digestEvents, 'family', { demo: true })
    }
    if (parts.length !== 1) throw new Error('preview_examples_unavailable')
    if (!options.apply) {
      emit({ schemaVersion: 1, status: 'ready', runId: options.runId, examples: examples.length,
        parts: options.historyDemo ? 2 : parts.length, ...(options.historyDemo ? { historyDemo: true } : {}), writes: 0, sends: 0 })
      return 0
    }
    stage = 'runtime'
    const runtime = dependencies.runtime ?? createRuntime({ token: env.AGI_EDU_BOT, projectId, instanceId: `design-preview-${process.pid}` }, { firestore: db })
    const resolver = dependencies.recipientResolver ?? createFirestoreProbeRecipientResolver(db)
    const historyReplyEventId = historyReplyEvent
      ? createDomainEvent({ ...historyReplyEvent, detectedAt: new Date().toISOString() }).eventId
      : null
    let firstMessageId = null
    const replyParts = () => makeHistoryReplyParts(historyReplyDisplayParts, firstMessageId)
    const service = dependencies.previewService ?? new ProbeNotificationService({ eventLedger: runtime.adapters.eventLedger,
      recipientResolver: resolver, renderer: (event) => options.historyDemo && event.eventId === historyReplyEventId ? replyParts() : parts })
    stage = 'enqueue'
    const firstQueued = await service.accept(inputEvent, { targetDigest: options.targetDigest })
    const firstReceipt = await deliverSpecific(firstQueued.jobId, parts.length)
    if (!options.historyDemo) {
      emitResult({ receipt: firstReceipt, examples: examples.length, parts: parts.length })
      return firstReceipt.sent ? 0 : 1
    }
    firstMessageId = firstReceipt.receipts[0]?.messageId ?? null
    if (!firstReceipt.sent || !Number.isSafeInteger(firstMessageId) || firstMessageId <= 0) {
      emit({ schemaVersion: 1, status: 'incomplete', runId: options.runId, historyDemo: true, examples: 0,
        parts: 2, first: firstReceipt.summary, reply: { state: 'skipped', parts: 1, receiptParts: 0 }, sends: firstReceipt.sends })
      return 1
    }
    const replyQueued = await service.accept(historyReplyEvent, { targetDigest: options.targetDigest })
    const replyReceipt = await deliverSpecific(replyQueued.jobId, 1)
    const complete = firstReceipt.sent && replyReceipt.sent
    emit({ schemaVersion: 1, status: complete ? 'sent' : 'incomplete', runId: options.runId, historyDemo: true,
      examples: 0, parts: 2, first: firstReceipt.summary, reply: replyReceipt.summary,
      sends: firstReceipt.sends + replyReceipt.sends,
      formats: [...new Set([...firstReceipt.receipts, ...replyReceipt.receipts].map((item) => item.format).filter(Boolean))] })
    return complete ? 0 : 1

    function emitResult({ receipt, examples: count, parts: partCount }) {
      emit({ schemaVersion: 1, status: receipt.sent ? 'sent' : 'incomplete', runId: options.runId,
        examples: count, parts: partCount, receiptParts: receipt.receipts.length,
        state: receipt.summary.state, formats: receipt.summary.formats })
    }
    async function deliverSpecific(jobId, expectedParts) {
      stage = 'receipt'
      let receipt = await readReceipt(jobId)
      let sends = 0
      if (receipt?.state !== 'sent') {
        stage = 'delivery'
        await runtime.notificationService.runOne({ jobId, skipRecovery: true })
        sends = 1
        receipt = await readReceipt(jobId)
      }
      const receipts = receipt?.partReceipts ?? []
      const sent = receipt?.state === 'sent' && receipts.length === expectedParts && receipts.every((item) => Number.isSafeInteger(item?.messageId))
      return { sent, receipts, sends, summary: { state: receipt?.state ?? 'missing', parts: expectedParts,
        receiptParts: receipts.length, formats: [...new Set(receipts.map((item) => item.format).filter(Boolean))] } }
    }
  } catch (error) {
    const allowed = new Set(['preview_usage', 'preview_project_unavailable', 'preview_token_unavailable', 'preview_recipient_unavailable', 'preview_examples_unavailable'])
    const nestedArray = /nested arrays|array.*array/i.test(error?.message ?? '')
    emit({ schemaVersion: 1, status: 'failed', stage, code: allowed.has(error.message) ? error.message : nestedArray ? 'preview_nested_arrays_rejected' : 'preview_failed' })
    return 1
  } finally {
    if (db && !dependencies.keepOpen) { try { await db.terminate?.() } catch { /* no secret diagnostics */ } }
  }
}

function makeHistoryReplyLedgerEvent(inputEvent) {
  return { ...inputEvent, scopeKey: `${inputEvent.scopeKey}:history-demo-reply`,
    sourceEventKey: `${inputEvent.sourceEventKey}:history-demo-reply`, sourceRevision: 'telegram-design-history-reply-v1' }
}

function makeHistoryDigestEvents() {
  const common = { source: 'firestore', eventType: 'review.changed', familyId: 'demo-family', childId: 'demo-child',
    privacyClass: 'family-summary', fields: { childName: 'Ученик А', subject: 'Пример' } }
  return [
    { ...common, eventType: 'upload.confirmed', workRef: { kind: 'day-task', id: 'a'.repeat(64) }, eventId: '1'.repeat(64), detectedAt: '2026-10-18T10:00:00.000Z', fields: { ...common.fields, title: 'Условная работа A' } },
    { ...common, workRef: { kind: 'day-task', id: 'b'.repeat(64) }, eventId: '2'.repeat(64), detectedAt: '2026-10-18T10:01:00.000Z', fields: { ...common.fields, title: 'Условная работа B', status: 'needs-fix', previousStatus: 'waiting', nextStep: 'Добавь пояснение к ответу.' } },
    { ...common, workRef: { kind: 'day-task', id: 'c'.repeat(64) }, eventId: '3'.repeat(64), detectedAt: '2026-10-18T10:02:00.000Z', fields: { ...common.fields, title: 'Условная работа C', status: 'verified', previousStatus: 'needs-fix', summary: 'Условный пример проверен.' } },
  ]
}

function makeHistoryReplyDisplayEvent() {
  const digestEvent = makeHistoryDigestEvents()[1]
  return { ...digestEvent, eventId: '4'.repeat(64), detectedAt: '2026-10-18T10:03:00.000Z',
    fields: { ...digestEvent.fields, status: 'verified', previousStatus: 'needs-fix', nextStep: undefined, summary: 'Пояснение добавлено. Замечание снято.' } }
}

function makeHistoryReplyParts(baseParts, messageId) {
  if (!Number.isSafeInteger(messageId) || messageId <= 0 || baseParts.length !== 1) throw new Error('preview_history_parent_unavailable')
  return baseParts.map((part) => ({ ...part, replyToMessageId: messageId }))
}

function withoutWorkBindings(parts) {
  return parts.map(({ workRefs: _workRefs, workOrderBindings: _workOrderBindings, ...part }) => part)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
