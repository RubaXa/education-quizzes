import { describe, expect, it } from 'vitest'
import { isValidNotificationPart, notificationMessageVersion, renderEvent, renderNotificationDigestParts, renderNotificationParts } from './domain/renderer.mjs'

const event = (eventType, fields = {}, extra = {}) => ({ source: 'firestore', privacyClass: 'family-summary', familyId: 'demo-family', childId: 'demo-child', eventType, fields, ...extra })

describe('notification renderers', () => {
  it('retains the confirmed quiz title through normalization into the compact message', async () => {
    const { createDomainEvent } = await import('./domain/events.mjs')
    const normalized = createDomainEvent({ source: 'firestore', familyId: 'demo-family', childId: 'demo-child',
      scopeKey: 'scope', sourceEventKey: 'quiz-a', sourceRevision: 'r1', detectedAt: '2026-10-18T08:00:00Z',
      eventType: 'quiz.submitted', privacyClass: 'family-summary',
      fields: { childName: 'Ученик А', subject: 'Математика', title: 'Деление с остатком', status: 'submitted' } })
    expect(renderNotificationParts(normalized, 'family')[0].plaintext).toContain('Деление с остатком')
  })

  it('keeps legacy renderEvent text arrays for existing consumers', () => {
    expect(renderEvent(event('grade.created', { childName: 'Ученик А', subject: 'Математика', value: '5' }), 'family')).toEqual([
      '📚 Изменения Education\n\nУченик А\n• Новая оценка: Математика\n  Оценка: 5',
    ])
  })

  it.each([
    ['upload.confirmed', { childName: 'Ученик А', subject: 'Математика', title: 'Упр. 2', occurredLabel: 'Задание к 2026-10-22' }],
    ['grade.created', { childName: 'Ученик Б', subject: 'Русский язык', value: '5' }],
    ['homework.assigned', { childName: 'Ученик А', subject: 'Математика', title: 'Страница 18' }],
    ['review.changed', { childName: 'Ученик Б', subject: 'Математика', title: '№ 3 · Книги на разных полках', status: 'needs-fix' }],
    ['quiz.submitted', { childName: 'Ученик А', subject: 'Окружающий мир', status: 'submitted' }],
    ['schedule.changed', { childName: 'Ученик Б', subject: 'Музыка', title: 'Урок перенесён' }],
    ['technical.probe', {}],
  ])('renders a valid structured template for %s', (type, fields) => {
    const parts = renderNotificationParts(event(type, fields), 'family')
    expect(notificationMessageVersion(parts)).toBe(2)
    expect(isValidNotificationPart(parts[0])).toBe(true)
    expect(JSON.parse(JSON.stringify(parts))).toEqual(parts)
    if (type === 'upload.confirmed') expect(parts[0].plaintext).toContain('К четвергу, 22 октября')
  })

  it('escapes fallback HTML and preserves literal user text in rich text, including Unicode', () => {
    const title = 'Домашка <img src=x> & "ёж" 🦊'
    const part = renderNotificationParts(event('homework.assigned', { title }), 'family')[0]
    expect(part.html).toContain('&lt;img src=x&gt; &amp; &quot;ёж&quot; 🦊')
    expect(part.html).toContain('Домашка &lt;img src=x&gt; &amp; &quot;ёж&quot; 🦊')
    expect(part.html).not.toContain('<img')
    expect(part.format).toBe('html')
    expect(part.rich_message.blocks).toEqual([{ type: 'paragraph', text: part.plaintext }])
    expect(part.html).not.toContain('<heading')
    expect([...part.plaintext].length).toBeLessThanOrEqual(3900)
  })

  it('generates only checked day action links and has no UI Kit demo action', () => {
    const upload = renderNotificationParts(event('upload.confirmed', { title: 'Работа' }, { navigationContext: { kind: 'day', dayToken: 'day-22' } }), 'family')[0]
    expect(upload.keyboard.buttons[0].url).toBe('https://rubaxa.github.io/education-quizzes/#/day/day-22')
    const demo = renderNotificationParts(event('homework.assigned', { title: 'Условная работа' }), 'family', { demo: true, action: { label: 'Открыть пример', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit' } })[0]
    expect(demo.plaintext).toContain('Пример · 1 изменение')
    expect(demo.plaintext).toContain('📅 Новое домашнее задание')
    expect(demo.plaintext.match(/Пример/g)).toHaveLength(1)
    expect(demo.keyboard).toBeUndefined()
    expect(notificationMessageVersion([demo])).toBe(2)
    const grade = renderNotificationParts(event('grade.created', { value: '5' }), 'family')[0]
    expect(grade.keyboard).toBeUndefined()
    const unsafe = renderNotificationParts(event('upload.confirmed', { title: 'x' }, { source: 'mesh', navigationContext: { kind: 'day', dayToken: 'day' } }), 'family')[0]
    expect(unsafe.keyboard).toBeUndefined()
  })

  it('rejects malformed v2 payloads and keeps v1 immutable jobs executable', () => {
    expect(notificationMessageVersion(['plain text'])).toBe(1)
    expect(notificationMessageVersion([{ plaintext: 'x', html: 'x', rich_message: { blocks: [{ type: 'heading', size: 9, text: 'x' }] }, demo: false }])).toBeNull()
    expect(notificationMessageVersion([{ plaintext: 'x', html: 'x', rich_message: { blocks: [{ type: 'paragraph', text: 'x' }, { type: 'photo', url: 'https://evil' }] }, demo: false }])).toBeNull()
    const invalidRef = { ...renderNotificationParts(event('upload.confirmed', { title: 'Работа' }), 'family')[0], workRefs: [{ kind: 'day-task', id: 'not-a-hash' }] }
    expect(notificationMessageVersion([invalidRef])).toBeNull()
    const invalidReply = { ...renderNotificationParts(event('upload.confirmed', { title: 'Работа' }), 'family')[0], replyToMessageId: 0 }
    expect(notificationMessageVersion([invalidReply])).toBeNull()
  })

  it('splits large digests into compact six-row parts without losing event facts', () => {
    const events = Array.from({ length: 50 }, (_, index) => event('review.changed', {
      childName: 'Ученик А', subject: 'Математика', title: `№ ${index + 1} · Задание ${index + 1}`, status: index % 2 ? 'needs-fix' : 'verified',
    }))
    const parts = renderNotificationDigestParts(events, 'family')
    expect(parts.length).toBeGreaterThan(1)
    const titles = parts.flatMap((part) => part.plaintext.split('\n').slice(2))
    expect(titles).toHaveLength(50)
    for (let index = 1; index <= 50; index += 1) expect(titles.join('\n')).toContain(`Задание ${index}`)
    for (const part of parts) {
      const rows = part.plaintext.split('\n').slice(2)
      expect(rows.length).toBeLessThanOrEqual(6)
      expect([...part.plaintext].length).toBeLessThanOrEqual(1200)
      expect(part.plaintext).toMatch(/часть \d+\/\d+/)
      expect(notificationMessageVersion([part])).toBe(2)
    }
  })

  it('keeps exact event-to-work bindings on every digest part without title matching', () => {
    const events = Array.from({ length: 8 }, (_, index) => event('review.changed', {
      childName: 'Ученик А', subject: 'Математика', title: 'Одинаковое название', status: index % 2 ? 'needs-fix' : 'verified',
    }, { workRef: { kind: 'day-task', id: String(index + 1).padStart(64, '0') }, eventId: String(index + 1).padStart(64, '0'), detectedAt: `2026-10-18T08:00:0${index}.000Z` }))
    const parts = renderNotificationDigestParts(events, 'family')
    expect(parts).toHaveLength(2)
    expect(parts[0].workRefs.map(ref => ref.id)).toEqual(events.slice(0, 6).map(item => item.workRef.id))
    expect(parts[1].workRefs.map(ref => ref.id)).toEqual(events.slice(6).map(item => item.workRef.id))
    expect(parts[0].workOrderBindings).toEqual(events.slice(0, 6).map(item => ({ workRef: item.workRef, order: `${item.detectedAt}:${item.eventId}` })))
    expect(parts[1].workOrderBindings).toEqual(events.slice(6).map(item => ({ workRef: item.workRef, order: `${item.detectedAt}:${item.eventId}` })))
    expect(parts.every(part => !Object.hasOwn(part, 'replyToMessageId'))).toBe(true)
    const bound = { ...parts[0], replyToMessageId: 42 }
    expect(notificationMessageVersion([bound])).toBe(2)
    expect(notificationMessageVersion([{ ...bound, replyToMessageId: Number.MAX_SAFE_INTEGER + 1 }])).toBeNull()
  })
})
