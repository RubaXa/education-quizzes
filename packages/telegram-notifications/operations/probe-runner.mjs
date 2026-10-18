/** @see ../../../docs/services/telegram-bot/operations.md */
import { createProbeScope, createTechnicalProbeSource } from './probe-source.mjs'
import { SourcePipeline } from '../application/source-pipeline.mjs'

/** Run one addressed technical observation through the ordinary checkpoint, ledger, and delivery guards. */
export async function runTechnicalProbe({ kind, db, familyId, childId, targetDigest, runId, meshScope = null,
  meshSource = null, checkpoints, probeNotifications, recipientResolver, deliver, readDeliveryReceipt,
  telemetry = null, apply = false, clock = () => new Date(), timeoutMs = 90_000, workerId = `probe-${process.pid}` }) {
  if (!['firestore', 'mesh'].includes(kind) || !db || !checkpoints || !probeNotifications
    || typeof deliver !== 'function' || typeof readDeliveryReceipt !== 'function'
    || !validId(familyId) || !validId(childId) || !validId(runId) || !/^[a-f0-9]{16}$/.test(targetDigest ?? '')
    || !Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 180_000) throw safeError('invalid_probe_request')
  const scope = createProbeScope({ kind, runId, targetDigest, familyId, childId, meshScope })
  const resolved = await span(telemetry, 'telegram.probe.recipient.resolve', () => recipientResolver.resolve({ digest: targetDigest, familyId, childId }))
  if (!resolved || resolved.familyId !== familyId || resolved.childId !== childId
    || !resolved.linkId || !resolved.personId || !resolved.telegramUserId) throw safeError('probe_recipient_unavailable')
  if (kind === 'mesh' && (!meshSource || !await meshSource.validateScope(meshScope))) throw safeError('mesh_scope_unavailable')
  const probeRef = db.doc(`telegramOperationalProbes/${runId}`)
  const existing = await probeRef.get()
  if (existing.exists) throw safeError('probe_run_exists')
  if (!apply) return Object.freeze({ status: 'ready', kind, runId, targetDigest })

  const source = createTechnicalProbeSource({ kind, db, recipientResolver, meshSource, clock,
    onMeshObservation: ({ recordCount }) => telemetry?.count?.('telegram.probe.mesh_records_observed', recordCount, { source: 'mesh' }) })
  let acceptance = null
  let callbackPromise = null
  const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId, clock,
    accept: async (event) => { acceptance = await span(telemetry, 'telegram.probe.event.accept',
      () => probeNotifications.accept(event, { targetDigest }), { source: kind }) } })
  let unsubscribe = null
  let timer = null
  try {
    const signalResult = new Promise((resolve, reject) => {
      const onSignal = () => {
        if (callbackPromise) return callbackPromise
        callbackPromise = (async () => {
          const result = await span(telemetry, 'telegram.probe.source_pipeline',
            () => pipeline.process(scope, { origin: 'live' }), { source: kind })
          if (result.status !== 'advanced' || result.events !== 1 || acceptance?.status !== 'queued' || acceptance.queued !== 1) {
            throw safeError('probe_pipeline_incomplete')
          }
          const delivered = await span(telemetry, 'telegram.probe.delivery', () => deliver(acceptance.jobId), { source: kind })
          if (!delivered) throw safeError('probe_delivery_not_attempted')
          const receipt = await span(telemetry, 'telegram.probe.receipt_readback',
            () => readDeliveryReceipt(acceptance.jobId), { source: kind })
          if (!receipt || receipt.state !== 'sent' || !Array.isArray(receipt.partReceipts) || receipt.partReceipts.length !== 1
            || !Number.isSafeInteger(receipt.partReceipts[0]?.messageId)) throw safeError('probe_delivery_receipt_unavailable')
          resolve({ result, acceptance, receipt })
        })().catch(reject)
        return callbackPromise
      }
      unsubscribe = source.subscribe({ scopes: [scope], onSignal })
    })
    await span(telemetry, 'telegram.probe.request.create', () => probeRef.create({ schemaVersion: 1, status: 'requested', source: kind, runId, familyId, childId,
      targetDigest, createdAt: clock().toISOString(), expiresAt: new Date(clock().valueOf() + 10 * 60_000).toISOString() })
      , { source: kind })
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(safeError('probe_timeout')), timeoutMs); timer.unref?.() })
    const completed = await Promise.race([signalResult, timeout])
    const finishedAt = clock().toISOString()
    await span(telemetry, 'telegram.probe.status.complete', () => probeRef.update({ status: 'completed', completedAt: finishedAt, eventId: completed.acceptance.eventId,
      deliveryState: completed.receipt.state, telegramReceiptId: completed.receipt.partReceipts[0].messageId }), { source: kind })
    return Object.freeze({ status: 'completed', kind, runId, eventId: completed.acceptance.eventId,
      deliveryState: completed.receipt.state, receiptParts: completed.receipt.partReceipts.length })
  } catch (error) {
    try { await probeRef.update({ status: 'failed', safeErrorCode: safeCode(error), completedAt: clock().toISOString() }) } catch { /* retain the original safe outcome */ }
    throw safeError(safeCode(error))
  } finally {
    if (timer) clearTimeout(timer)
    try { await unsubscribe?.() } catch { /* listener cleanup is best effort */ }
    if (callbackPromise) await callbackPromise.catch(() => {})
  }
}

function span(telemetry, operation, work, attrs = {}) {
  return telemetry?.span ? telemetry.span(operation, work, attrs) : work()
}

function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function safeCode(error) {
  const allowed = new Set(['invalid_probe_request', 'probe_recipient_unavailable', 'mesh_scope_unavailable', 'probe_run_exists',
    'probe_pipeline_incomplete', 'probe_delivery_not_attempted', 'probe_delivery_receipt_unavailable', 'probe_timeout',
    'checkpoint_stale_lease', 'checkpoint_too_large', 'source_snapshot_incomplete', 'source_owner_changed'])
  return allowed.has(error?.safeCode) ? error.safeCode : allowed.has(error?.message) ? error.message : 'probe_failed'
}
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
