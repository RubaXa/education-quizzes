import { createDomainEvent } from '../domain/events.mjs'
import { assertPort } from '../domain/ports.mjs'

/** @see ../../../docs/services/telegram-bot/operations.md */
export class ProbeNotificationService {
  constructor({ eventLedger, recipientResolver, renderer, clock = () => new Date() }) {
    this.ledger = assertPort(eventLedger, ['recordIfAbsent'])
    if (!recipientResolver || typeof recipientResolver.resolve !== 'function' || typeof renderer !== 'function') {
      throw new Error('probe_notification_dependency_unavailable')
    }
    this.recipientResolver = recipientResolver
    this.renderer = renderer
    this.clock = clock
  }

  async accept(input, { targetDigest } = {}) {
    if (input?.eventType !== 'technical.probe' || (input.fields && Object.keys(input.fields).length)
      || (input.contextRefs?.length ?? 0) !== 0) throw new Error('invalid_probe_event')
    const event = createDomainEvent({ ...input, detectedAt: input.detectedAt ?? this.clock().toISOString() })
    const target = await this.recipientResolver.resolve({ digest: targetDigest, familyId: event.familyId, childId: event.childId })
    if (!target || target.familyId !== event.familyId || target.childId !== event.childId
      || !target.linkId || !target.personId || !target.telegramUserId) throw new Error('probe_recipient_unavailable')
    const job = {
      jobId: `${event.eventId}_${target.linkId}`,
      eventId: event.eventId,
      event,
      messageVersion: 1,
      messageParts: this.renderer(event, 'family'),
      linkId: target.linkId,
      familyId: target.familyId,
      personId: target.personId,
      childId: target.childId,
      telegramUserId: String(target.telegramUserId),
      partReceipts: [],
      state: 'pending',
      attempts: 0,
      nextAttemptAt: this.clock().toISOString(),
    }
    const receipt = await this.ledger.recordIfAbsent({ event, jobs: [job] })
    return Object.freeze({ status: receipt.created ? 'queued' : 'reused', eventId: event.eventId,
      queued: receipt.queued ?? 0, targetDigest, jobId: job.jobId })
  }
}
