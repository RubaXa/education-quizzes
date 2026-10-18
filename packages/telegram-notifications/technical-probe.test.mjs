import { describe, expect, it } from 'vitest'
import { createDomainEvent } from './domain/events.mjs'
import { renderEvent } from './domain/renderer.mjs'

const base = { source: 'firestore', scopeKey: 'probe-scope', familyId: 'family-a', childId: 'child-a',
  sourceEventKey: 'probe-run', sourceRevision: '1', eventType: 'technical.probe', privacyClass: 'family-summary',
  detectedAt: '2026-10-17T12:00:00.000Z', fields: { token: 'must never be rendered', value: '5' } }

describe('technical Telegram probe message', () => {
  it('renders only fixed service text for the family and never exposes payload fields', () => {
    const event = createDomainEvent(base)
    const rendered = renderEvent(event, 'family')
    expect(rendered).toEqual(['PETR: техническая проверка уведомлений. Это служебное сообщение; учебные данные не использовались.'])
    expect(rendered.join(' ')).not.toContain('must never be rendered')
    expect(rendered.join(' ')).not.toContain('5')
    expect(renderEvent(event, 'team')).toEqual([])
  })

  it('rejects unsupported technical event source and excludes user fields', () => {
    expect(() => createDomainEvent({ ...base, source: 'unknown' })).toThrow('invalid_event_source')
    const event = createDomainEvent({ ...base, fields: { childName: 'Private name' } })
    expect(event.fields).toEqual({})
    expect(renderEvent(event, 'family')[0]).not.toContain('Private name')
  })
})
