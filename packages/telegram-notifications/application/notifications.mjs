import { createHash } from 'node:crypto'
import { assertPort } from '../domain/ports.mjs'
import { createDomainEvent } from '../domain/events.mjs'
import { notificationMessageVersion } from '../domain/renderer.mjs'

/** @see ../../../docs/services/telegram-bot/event-ledger-outbox.md#атомарность-и-идемпотентность @see ../../../docs/services/telegram-bot/delivery.md#разделение-ответственности @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов */
export class NotificationService {
  constructor({ eventLedger, outbox, recipients, membership, channel = null, renderer, delivery, clock = () => new Date(), logger = { info() {}, error() {} }, workerId, retryMaxAttempts = 8, leaseMs = 120_000, recoveryIntervalMs = 60_000, telemetry = null }) {
    this.ledger = assertPort(eventLedger, ['recordIfAbsent'])
    this.outbox = assertPort(outbox, ['claim', 'finish', 'reschedule', 'recoverExpired', 'renew', 'savePartReceipt'])
    this.recipients = assertPort(recipients, ['resolveVerified'])
    this.membership = assertPort(membership, ['isActiveMember'])
    this.channel = channel ? assertPort(channel, ['getState', 'markUnavailable']) : { async getState() { return { status: 'available', version: 0 } }, async markUnavailable() { return { applied: true } } }
    this.renderer = renderer
    this.delivery = delivery
    this.clock = clock
    this.logger = logger
    this.workerId = workerId
    this.retryMaxAttempts = retryMaxAttempts
    this.leaseMs = leaseMs
    this.recoveryIntervalMs = recoveryIntervalMs
    this.telemetry = telemetry
    this.lastRecoveryAt = 0
  }

  async accept(event) {
    const normalized = createDomainEvent({ ...event, detectedAt: event?.detectedAt ?? this.clock().toISOString() })
    if (normalized.privacyClass !== 'family-summary') throw new Error('privacy_route_unavailable')
    const targets = await this.recipients.resolveVerified(normalized)
    const safeTargets = []
    for (const target of targets) {
      if (target?.type !== 'family-link' || !target.linkId || !target.familyId || !target.personId || !target.telegramUserId) continue
      if (![target.linkId, target.familyId, target.personId, target.childId ?? normalized.childId].every(validDocId)) continue
      if (target.childId && target.childId !== normalized.childId) continue
      if (!validTelegramUserId(target.telegramUserId) || target.familyId !== normalized.familyId
        || !await this.membership.isActiveMember({ ...target, childId: normalized.childId })) continue
      safeTargets.push(target)
    }
    const messageParts = this.renderer(normalized, 'family')
    const messageVersion = notificationMessageVersion(messageParts)
    if (!messageVersion) throw new Error('invalid_notification_render')
    const jobs = safeTargets.map((target) => ({
      jobId: `${normalized.eventId}_${target.linkId}`,
      eventId: normalized.eventId,
      event: normalized,
      messageVersion,
      messageParts,
      linkId: target.linkId,
      familyId: target.familyId,
      personId: target.personId,
      childId: normalized.childId,
      telegramUserId: String(target.telegramUserId),
      partReceipts: [],
      state: 'pending', attempts: 0, nextAttemptAt: this.clock().toISOString(),
    }))
    return this.ledger.recordIfAbsent({ event: normalized, jobs })
  }

  async runOne({ jobId = null, skipRecovery = false } = {}) {
    const startedAt = this.clock().valueOf()
    if (!skipRecovery && startedAt - this.lastRecoveryAt >= this.recoveryIntervalMs) {
      await this.outbox.recoverExpired(this.clock().toISOString(), { maxAttempts: this.retryMaxAttempts, recoveryDelayMs: 1_000 })
      this.lastRecoveryAt = startedAt
    }
    const job = await this.outbox.claim({ workerId: this.workerId, now: this.clock().toISOString(), leaseMs: this.leaseMs, maxAttempts: this.retryMaxAttempts,
      ...(jobId ? { jobId } : {}) })
    if (!job) return false
    const processClaimed = () => this.processClaimedJob(job)
    const eventId = /^[a-f0-9]{64}$/.test(job.eventId ?? '') ? job.eventId : undefined
    const safeJobId = typeof job.jobId === 'string' ? createHash('sha256').update(job.jobId).digest('hex') : undefined
    return this.telemetry?.span ? this.telemetry.span('telegram.notification.job', processClaimed,
      { ...(eventId ? { eventId } : {}), ...(safeJobId ? { jobId: safeJobId } : {}) }) : processClaimed()
  }

  async processClaimedJob(job) {
    let channelAttempt = null
    let channelCheckInProgress = false
    try {
      if (!await this.membership.isActiveMember(job)) {
        await this.outbox.finish({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: this.clock().toISOString(), result: { state: 'blocked', safeErrorCode: 'membership_inactive' } })
        return true
      }
      channelCheckInProgress = true
      const channelState = await this.channel.getState(job.telegramUserId)
      channelCheckInProgress = false
      if (channelState.status !== 'available') {
        await this.outbox.finish({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: this.clock().toISOString(), result: { state: 'blocked', safeErrorCode: 'channel_unavailable' } })
        return true
      }
      if (notificationMessageVersion(job.messageParts) !== job.messageVersion) {
        await this.outbox.finish({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: this.clock().toISOString(), result: { state: 'dead_letter', safeErrorCode: 'unsupported_job_schema' } })
        return true
      }
      const messages = job.messageParts
      const receipts = [...(job.partReceipts ?? [])]
      for (let index = receipts.length; index < messages.length; index += 1) {
        const beforePart = this.clock().toISOString()
        if (!await this.membership.isActiveMember(job)) {
          await this.outbox.finish({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: beforePart, result: { state: 'blocked', safeErrorCode: 'membership_inactive' } })
          return true
        }
        channelCheckInProgress = true
        const beforeState = await this.channel.getState(job.telegramUserId)
        channelCheckInProgress = false
        if (beforeState.status !== 'available') {
          await this.outbox.finish({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: beforePart, result: { state: 'blocked', safeErrorCode: 'channel_unavailable' } })
          return true
        }
        await this.outbox.renew({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: beforePart, leaseMs: this.leaseMs })
        channelAttempt = { senderId: job.telegramUserId, attemptStartedAt: Date.parse(beforePart), expectedVersion: beforeState.version }
        const receipt = job.messageVersion === 2
          ? await this.delivery.send({ chatId: job.telegramUserId, part: messages[index] })
          : await this.delivery.send({ chatId: job.telegramUserId, text: messages[index] })
        channelAttempt = null
        const afterPart = this.clock().toISOString()
        await this.outbox.savePartReceipt({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, index, receipt, now: afterPart, leaseMs: this.leaseMs })
        receipts.push(receipt)
      }
      await this.outbox.finish({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: this.clock().toISOString(), result: { state: 'sent', partReceipts: receipts } })
    } catch (error) {
      if (error?.safeCode === 'stale_lease') return true
      let safe = channelCheckInProgress ? { code: 'channel_state_unavailable', retryable: true } : classify(error)
      if (error?.safeCode === 'channel_unavailable' && channelAttempt) {
        const result = await this.channel.markUnavailable(channelAttempt)
        if (!result.applied && result.state === 'available') safe = { code: 'channel_state_changed', retryable: true }
        else safe = { code: 'channel_unavailable', retryable: false }
      }
      const attempts = job.attempts ?? 1
      try {
        if (!safe.retryable || attempts >= this.retryMaxAttempts) {
          await this.outbox.finish({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: this.clock().toISOString(), result: { state: ['recipient_blocked', 'channel_unavailable'].includes(safe.code) ? 'blocked' : 'dead_letter', safeErrorCode: safe.code } })
        } else {
          const backoffMs = safe.retryAfterMs ?? Math.min(60 * 60_000, 1000 * (2 ** Math.min(attempts, 12)))
          await this.outbox.reschedule({ jobId: job.jobId, workerId: this.workerId, leaseToken: job.leaseToken, now: this.clock().toISOString(), attempts, nextAttemptAt: new Date(this.clock().valueOf() + backoffMs).toISOString(), safeErrorCode: safe.code })
        }
      } catch (leaseError) {
        if (leaseError?.safeCode === 'stale_lease') return true
        throw leaseError
      }
      this.logger.error({ code: safe.code })
    }
    return true
  }
}

const validDocId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && !['.', '..'].includes(value) && !value.includes('/') && !value.includes('\\') && !hasControlByte(value)
const validTelegramUserId = (value) => /^\d{1,20}$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0
const hasControlByte = (value) => [...value].some((character) => character.charCodeAt(0) < 32)

function classify(error) {
  const code = error?.safeCode
  if (code === 'recipient_blocked') return { code, retryable: false }
  if (code === 'rate_limited') return { code, retryable: true, retryAfterMs: error.retryAfterMs }
  if (['telegram_temporary', 'network_unavailable'].includes(code)) return { code, retryable: true }
  return { code: 'delivery_failed', retryable: false }
}
