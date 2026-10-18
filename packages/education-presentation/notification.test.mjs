import { describe, expect, it } from 'vitest'
import { getNotificationPresentation, getNotificationDigestPresentation, NOTIFICATION_EXAMPLES, STATUS_PRESENTATION, validateNotificationAction } from './notification.mjs'

describe('shared notification presentation', () => {
  it('shares the complete Education status vocabulary, CSS tones and Lucide names', () => {
    expect(Object.keys(STATUS_PRESENTATION)).toEqual(['ready', 'started', 'uploading', 'waiting', 'processing', 'paused', 'complete', 'partial', 'needs-fix', 'incorrect', 'unknown', 'failed', 'new'])
    expect(STATUS_PRESENTATION.complete).toMatchObject({ tone: 'success', emoji: '🟢', icon: 'CircleCheck' })
    expect(STATUS_PRESENTATION.waiting.emoji).toBe('🔵')
    expect(STATUS_PRESENTATION['needs-fix'].tone).toBe('attention')
  })

  it('ships only conditional, explicitly demo-labeled example events', () => {
    expect(NOTIFICATION_EXAMPLES.map(({ id }) => id)).toEqual(['upload', 'grade', 'homework', 'review', 'quiz', 'schedule', 'technical'])
    expect(NOTIFICATION_EXAMPLES.every(({ event }) => event.demo === true && (['Ученик А', 'Ученик Б'].includes(event.fields?.childName) || event.eventType === 'technical.probe'))).toBe(true)
    expect(NOTIFICATION_EXAMPLES.some(({ event }) => event.familyId !== 'demo-family' || !event.childId.startsWith('demo-'))).toBe(false)
  })

  it('uses Russian due dates and distinguishes photo receipt from verification', () => {
    const upload = getNotificationPresentation({ eventType: 'upload.confirmed', fields: { occurredLabel: 'Задание к 2026-10-22' } })
    expect(upload.occurredLabel).toBe('К четвергу, 22 октября')
    expect(upload.status?.id).toBe('waiting')
    expect(getNotificationPresentation({ eventType: 'quiz.submitted', fields: { status: 'submitted' } }).status?.id).toBe('waiting')
    expect(getNotificationPresentation({ eventType: 'review.changed', fields: { status: 'verified' } }).status?.id).toBe('complete')
    expect(getNotificationPresentation(NOTIFICATION_EXAMPLES[1].event, { demo: true }).headline).toBe('Пример · Новая оценка')
  })

  it('accepts only canonical day links and demo-only UI Kit links', () => {
    const event = { source: 'firestore', eventType: 'upload.confirmed', navigationContext: { kind: 'day', dayToken: 'safe_day-1' }, fields: {} }
    expect(getNotificationPresentation(event).action?.url).toBe('https://rubaxa.github.io/education-quizzes/#/day/safe_day-1')
    expect(getNotificationPresentation({ ...event, navigationContext: undefined }, { action: { label: 'Подмена', url: 'https://rubaxa.github.io/education-quizzes/#/day/other-child' } }).action).toBeNull()
    expect(getNotificationPresentation({ ...event, source: 'mesh' }).action).toBeNull()
    expect(validateNotificationAction({ label: 'x', url: 'https://rubaxa.github.io/education-quizzes/#/day/a' })).not.toBeNull()
    for (const url of ['https://evil.example/#/day/a', 'https://rubaxa.github.io.evil.example/education-quizzes/#/day/a', 'https://rubaxa.github.io/education-quizzes/?x=1#/day/a', 'https://rubaxa.github.io/education-quizzes/#/ui-kit']) {
      expect(validateNotificationAction({ label: 'x', url })).toBeNull()
    }
    expect(validateNotificationAction({ label: 'Демо', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit' }, { demo: true })).not.toBeNull()
    expect(validateNotificationAction({ label: 'Демо', url: 'https://rubaxa.github.io/education-quizzes/#/day/a' }, { demo: true })).toBeNull()
  })

  it('does not repeat a shared subject in grade rows and retains change type and date', () => {
    const grades = [
      { eventType: 'grade.created', fields: { childName: 'Ученик А', subject: 'Математика', value: '5', occurredLabel: 'Сегодня' } },
      { eventType: 'grade.changed', fields: { childName: 'Ученик А', subject: 'Математика', value: '4' } },
    ]
    const digest = getNotificationDigestPresentation(grades)
    expect(digest.text.match(/Математика/g)).toHaveLength(1)
    expect(digest.text).toContain('Новая оценка 5 · Сегодня')
    expect(digest.text).toContain('Оценка изменена: 4')
    const mixed = getNotificationDigestPresentation([grades[0], { ...grades[1], fields: { ...grades[1].fields, subject: 'Русский язык' } }])
    expect(mixed.text.match(/Математика/g)).toHaveLength(1)
    expect(mixed.text.match(/Русский язык/g)).toHaveLength(1)
  })

  it('builds compact review rows from exact context and never attributes a missing subject', () => {
    const review = getNotificationDigestPresentation([{ eventType: 'review.changed', fields: {
      childName: 'Ученик А', subject: 'Математика', title: '№ 3 · Книги на разных полках', status: 'needs-fix',
    } }])
    expect(review.text).toBe('Ученик А · Математика\n🟠 № 3 · Книги на разных полках — нужна правка')
    expect(getNotificationDigestPresentation([{ eventType: 'review.changed', fields: { childName: 'Ученик А', status: 'verified' } }])).toBeNull()

    const mixed = getNotificationDigestPresentation([
      { eventType: 'grade.created', fields: { childName: 'Ученик А', value: '5' } },
      { eventType: 'grade.created', fields: { subject: 'Русский язык', value: '4' } },
    ])
    expect(mixed.childName).toBeNull()
    expect(mixed.subject).toBeNull()
    expect(mixed.text).toContain('Ученик А')
    expect(mixed.text).toContain('Русский язык')
    expect(mixed.text).not.toMatch(/^.*Русский язык.*\n/)
  })
})
