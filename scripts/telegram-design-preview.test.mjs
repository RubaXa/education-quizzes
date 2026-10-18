import { describe, expect, it, vi } from 'vitest'
import { main, parseDesignPreviewArgs } from './telegram-design-preview.mjs'
import { ProbeNotificationService } from '../packages/telegram-notifications/application/probe-notifications.mjs'
import { renderNotificationParts, renderNotificationDigestParts } from '../packages/telegram-notifications/domain/renderer.mjs'
import { NOTIFICATION_EXAMPLES } from '../packages/education-presentation/notification.mjs'

const args = ['--target-digest', 'a'.repeat(16), '--run-id', 'design-example']
function fixture({ target = {}, existing = false, fail = false } = {}) {
  const outputs = []
  const send = vi.fn(async () => {})
  let sent = existing
  const deps = {
    env: { AGI_EDU_BOT: 'test-only', TELEGRAM_FIRESTORE_PROJECT_ID: 'demo-project' },
    db: { terminate: vi.fn() }, resolveTarget: vi.fn(async () => target && { familyId: 'family-a', childId: 'child-a', ...target }),
    runtime: { notificationService: { runOne: vi.fn(async () => { await send(); if (!fail) sent = true }) } },
    previewService: { accept: vi.fn(async (event) => { expect(event.eventType).toBe('technical.probe'); expect(event.fields).toEqual({}); return { jobId: 'job-a' } }) },
    readReceipt: vi.fn(async () => ({ state: sent ? 'sent' : 'retry_wait', partReceipts: sent ? [{ messageId: 1, format: 'html' }] : [] })),
    write: (text) => outputs.push(JSON.parse(text)),
  }
  return { deps, outputs, send }
}

describe('Telegram design examples CLI', () => {
  it('persists immutable version 2 examples through the real common probe job builder', async () => {
    const recordIfAbsent = vi.fn(async () => ({ created: true, queued: 1 }))
    const service = new ProbeNotificationService({ eventLedger: { recordIfAbsent },
      recipientResolver: { resolve: async () => ({ familyId: 'family-a', childId: 'child-a', linkId: 'link-a', personId: 'parent-a', telegramUserId: '55' }) },
      renderer: () => renderNotificationParts(NOTIFICATION_EXAMPLES[0].event, 'family', { demo: true }) })
    await service.accept({ source: 'firestore', scopeKey: 'design-scope', sourceEventKey: 'design-event', sourceRevision: 'v1',
      eventType: 'technical.probe', familyId: 'family-a', childId: 'child-a', privacyClass: 'family-summary', fields: {} }, { targetDigest: 'a'.repeat(16) })
    const stored = recordIfAbsent.mock.calls[0][0]
    expect(stored.event.eventType).toBe('technical.probe')
    expect(stored.event.fields).toEqual({})
    expect(stored.jobs[0]).toMatchObject({ messageVersion: 2, state: 'pending', partReceipts: [] })
    expect(stored.jobs[0].messageParts[0].plaintext).toContain('Пример ·')
  })

  it('renders the screenshot regression as one compact informative review digest', () => {
    const fields = [
      { title: '№3 · Шестьдесят горшков', status: 'verified' },
      { title: '№1 · Книги на полках', status: 'needs-fix' },
      { title: '№5 · Периметр прямоугольника', status: 'verified' },
    ]
    const parts = renderNotificationDigestParts(fields.map(item => ({ eventType: 'review.changed', privacyClass: 'family-summary',
      fields: { childName: 'Ученик А', subject: 'Математика', ...item } })), 'family', { demo: true })
    expect(parts).toHaveLength(1)
    expect(parts[0].format).toBe('html')
    expect(parts[0].plaintext.split('\n')).toHaveLength(4)
    expect(parts[0].plaintext).toContain('№1 · Книги на полках — нужна правка')
    expect(parts[0].rich_message.blocks.some(block => ['heading', 'divider', 'footer'].includes(block.type))).toBe(false)
  })

  it('reads only the existing job in receipt-only mode, without queueing or sending', async () => {
    const f = fixture({ target: { linkId: 'link-a' } })
    f.deps.db.doc = vi.fn(() => ({ get: async () => ({ exists: true, data: () => ({ state: 'sent', messageVersion: 2, messageParts: [1,2,3,4], partReceipts: [{ messageId: 1, format: 'rich_message' }] }) }) }))
    expect(await main([...args, '--receipt-only'], f.deps)).toBe(0)
    expect(f.outputs[0]).toMatchObject({ status: 'diagnostic', state: 'sent', writes: 0, sends: 0 })
    expect(f.deps.previewService.accept).not.toHaveBeenCalled()
    expect(f.send).not.toHaveBeenCalled()
    expect(() => parseDesignPreviewArgs([...args, '--receipt-only', '--apply'])).toThrow('preview_usage')
  })

  it('requires one explicit opaque target and stable run id', () => {
    expect(parseDesignPreviewArgs(args)).toMatchObject({ targetDigest: 'a'.repeat(16), runId: 'design-example', apply: false })
    for (const bad of [[], [...args, '--apply', '--apply'], ['--target-digest', '123'], [...args, '--run-id', 'again']]) expect(() => parseDesignPreviewArgs(bad)).toThrow('preview_usage')
  })
  it('dry run checks recipient and exact templates without writing or sending', async () => {
    const f = fixture()
    expect(await main(args, f.deps)).toBe(0)
    expect(f.outputs[0]).toMatchObject({ status: 'ready', examples: 3, parts: 1, writes: 0, sends: 0 })
    expect(f.deps.previewService.accept).not.toHaveBeenCalled()
    expect(f.send).not.toHaveBeenCalled()
    expect(f.deps.db.terminate).toHaveBeenCalled()
  })
  it('delivers a technical demonstration through common outbox service and verifies all receipts', async () => {
    const f = fixture()
    expect(await main([...args, '--apply'], f.deps)).toBe(0)
    expect(f.deps.runtime.notificationService.runOne).toHaveBeenCalledWith({ jobId: 'job-a', skipRecovery: true })
    expect(f.outputs[0]).toMatchObject({ status: 'sent', examples: 3, parts: 1, receiptParts: 1, formats: ['html'] })
    expect(JSON.stringify(f.outputs)).not.toMatch(/family-a|child-a|job-a/)
  })
  it('does not replay an already sent stable run', async () => {
    const f = fixture({ existing: true })
    expect(await main([...args, '--apply'], f.deps)).toBe(0)
    expect(f.send).not.toHaveBeenCalled()
  })
  it('does not claim success when retry remains incomplete', async () => {
    const f = fixture({ fail: true })
    expect(await main([...args, '--apply'], f.deps)).toBe(1)
    expect(f.outputs[0]).toMatchObject({ status: 'incomplete', receiptParts: 0 })
  })
  it('refuses an unverified recipient', async () => {
    const f = fixture({ target: null })
    expect(await main([...args, '--apply'], f.deps)).toBe(1)
    expect(f.send).not.toHaveBeenCalled()
    expect(f.outputs[0]).toMatchObject({ code: 'preview_recipient_unavailable' })
  })
})
