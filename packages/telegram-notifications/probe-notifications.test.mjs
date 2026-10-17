import { describe, expect, it, vi } from 'vitest'
import { createFirestoreProbeRecipientResolver, opaqueLinkDigest } from './adapters/probe-recipient-firestore.mjs'
import { ProbeNotificationService } from './application/probe-notifications.mjs'
import { renderEvent } from './domain/renderer.mjs'

function probeDb({ link = { familyId: 'family-a', personId: 'parent-a', telegramUserId: '12345', status: 'active' },
  account = { status: 'registered' }, member = { active: true, role: 'parent', childIds: ['child-a'] } } = {}) {
  return {
    collection(name) { return { where(field, op, value) { return { async get() {
      const rows = name === 'telegramBotFamilyLinks' && field === 'familyId' && value === 'family-a' && link ? [['opaque-link-id', link]] : []
      return { docs: rows.map(([id, data]) => ({ id, data: () => data })) }
    } } } } },
    doc(path) { return { async get() {
      const data = path === 'telegramBotAccounts/12345' ? account
        : path === 'families/family-a/members/parent-a' ? member : null
      return { exists: Boolean(data), data: () => data }
    } } },
  }
}
const event = { source: 'firestore', scopeKey: 'probe-scope', familyId: 'family-a', childId: 'child-a',
  sourceEventKey: 'run-id-1', sourceRevision: '1', eventType: 'technical.probe', privacyClass: 'family-summary',
  detectedAt: '2026-10-17T12:00:00.000Z', fields: {} }

describe('narrow technical probe notification', () => {
  it('creates exactly one job for the selected verified link with fixed technical text', async () => {
    const recordIfAbsent = vi.fn(async ({ jobs }) => ({ created: true, queued: jobs.length }))
    const service = new ProbeNotificationService({ eventLedger: { recordIfAbsent },
      recipientResolver: createFirestoreProbeRecipientResolver(probeDb()), renderer: renderEvent,
      clock: () => new Date('2026-10-17T12:00:00.000Z') })
    const digest = opaqueLinkDigest('opaque-link-id')
    const result = await service.accept(event, { targetDigest: digest })
    expect(result).toMatchObject({ status: 'queued', queued: 1, targetDigest: digest })
    const [{ event: saved, jobs }] = recordIfAbsent.mock.calls[0]
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ linkId: 'opaque-link-id', familyId: 'family-a', personId: 'parent-a', telegramUserId: '12345' })
    expect(jobs[0].messageParts).toEqual(['PETR: техническая проверка уведомлений. Это служебное сообщение; учебные данные не использовались.'])
    expect(saved.eventType).toBe('technical.probe')
  })

  it.each([
    ['blocked channel', { account: { status: 'registered', channelStatus: 'blocked' } }],
    ['inactive member', { member: { active: false, role: 'parent', childIds: ['child-a'] } }],
    ['student role', { member: { active: true, role: 'student', childIds: ['child-a'] } }],
  ])('rejects a target with %s', async (_label, overrides) => {
    const resolver = createFirestoreProbeRecipientResolver(probeDb(overrides))
    await expect(resolver.resolve({ digest: opaqueLinkDigest('opaque-link-id'), familyId: 'family-a', childId: 'child-a' })).resolves.toBeNull()
  })

  it('rejects arbitrary payloads before creating ledger records', async () => {
    const recordIfAbsent = vi.fn()
    const service = new ProbeNotificationService({ eventLedger: { recordIfAbsent },
      recipientResolver: createFirestoreProbeRecipientResolver(probeDb()), renderer: renderEvent })
    await expect(service.accept({ ...event, fields: { title: 'private homework' } }, { targetDigest: opaqueLinkDigest('opaque-link-id') }))
      .rejects.toThrow('invalid_probe_event')
    expect(recordIfAbsent).not.toHaveBeenCalled()
  })
})
