import { describe, expect, it } from 'vitest'
import { isValidNotificationPart, notificationMessageVersion, renderEvent, renderNotificationParts } from './domain/renderer.mjs'

const event = (eventType, fields = {}, extra = {}) => ({ source: 'firestore', privacyClass: 'family-summary', familyId: 'demo-family', childId: 'demo-child', eventType, fields, ...extra })

describe('notification renderers', () => {
  it('keeps legacy renderEvent text arrays for existing consumers', () => {
    expect(renderEvent(event('grade.created', { childName: 'Ученик А', subject: 'Математика', value: '5' }), 'family')).toEqual([
      '📚 Изменения Education\n\nУченик А\n• Новая оценка: Математика\n  Оценка: 5',
    ])
  })

  it.each([
    ['upload.confirmed', { childName: 'Ученик А', subject: 'Математика', title: 'Упр. 2', occurredLabel: 'Задание к 2026-10-22' }],
    ['grade.created', { childName: 'Ученик Б', subject: 'Русский язык', value: '5' }],
    ['homework.assigned', { childName: 'Ученик А', subject: 'Математика', title: 'Страница 18' }],
    ['review.changed', { childName: 'Ученик Б', subject: 'Математика', status: 'needs-fix' }],
    ['quiz.submitted', { childName: 'Ученик А', subject: 'Окружающий мир', status: 'submitted' }],
    ['schedule.changed', { childName: 'Ученик Б', subject: 'Музыка', title: 'Урок перенесён' }],
    ['technical.probe', {}],
  ])('renders a valid structured template for %s', (type, fields) => {
    const parts = renderNotificationParts(event(type, fields), 'family')
    expect(notificationMessageVersion(parts)).toBe(2)
    expect(isValidNotificationPart(parts[0])).toBe(true)
    expect(JSON.parse(JSON.stringify(parts))).toEqual(parts)
    if (type === 'upload.confirmed') expect(parts[0].html).toContain('<i>К четвергу, 22 октября</i>')
  })

  it('escapes fallback HTML and preserves literal user text in rich text, including Unicode', () => {
    const title = 'Домашка <img src=x> & "ёж" 🦊'
    const part = renderNotificationParts(event('homework.assigned', { title }), 'family')[0]
    expect(part.html).toContain('&lt;img src=x&gt; &amp; &quot;ёж&quot; 🦊')
    expect(part.html).toContain('<b>Задание: Домашка &lt;img src=x&gt; &amp; &quot;ёж&quot; 🦊</b>')
    expect(part.html).not.toContain('<img')
    const titleBlock = part.rich_message.blocks.find((block) => block.type === 'heading' && block.size === 3)
    expect(titleBlock.text.text).toContain('<img src=x>')
    expect(titleBlock.text.type).toBe('bold')
    expect([...part.plaintext].length).toBeLessThanOrEqual(3900)
  })

  it('generates only checked day action links and has no grade action without context', () => {
    const upload = renderNotificationParts(event('upload.confirmed', { title: 'Работа' }, { navigationContext: { kind: 'day', dayToken: 'day-22' } }), 'family')[0]
    expect(upload.keyboard.buttons[0].url).toBe('https://rubaxa.github.io/education-quizzes/#/day/day-22')
    const demo = renderNotificationParts(event('homework.assigned', { title: 'Условная работа' }), 'family', { demo: true, action: { label: 'Открыть пример', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit' } })[0]
    expect(demo.plaintext).toContain('Пример · Новое домашнее задание')
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
    const valid = renderNotificationParts(event('upload.confirmed', { title: 'Работа' }, { navigationContext: { kind: 'day', dayToken: 'owned-day' } }), 'family')[0]
    valid.rich_message.blocks.find((block) => block.type === 'buttons').buttons[0].url = 'https://rubaxa.github.io/education-quizzes/#/day/other-day'
    expect(notificationMessageVersion([valid])).toBeNull()
  })
})
