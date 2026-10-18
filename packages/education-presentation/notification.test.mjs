import { describe, expect, it } from 'vitest'
import { getNotificationPresentation, getNotificationDigestPresentation, NOTIFICATION_EXAMPLES, STATUS_PRESENTATION, validateNotificationAction, isValidWorkRef } from './notification.mjs'

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
    expect(digest.text).toContain('📝 Новая оценка 5')
    expect(digest.text).toContain('📝 Оценка изменена: 4')
    const mixed = getNotificationDigestPresentation([grades[0], { ...grades[1], fields: { ...grades[1].fields, subject: 'Русский язык' } }])
    expect(mixed.text.match(/Математика/g)).toHaveLength(1)
    expect(mixed.text.match(/Русский язык/g)).toHaveLength(1)
  })

  it('builds compact review rows from exact context and never attributes a missing subject', () => {
    const review = getNotificationDigestPresentation([{ eventType: 'review.changed', fields: {
      childName: 'Ученик А', subject: 'Математика', title: '№ 3 · Книги на разных полках', status: 'needs-fix',
    } }])
    expect(review.text).toBe('Ученик А · 1 изменение\nМатематика\n🟠 № 3 · Книги на разных полках — нужна правка')
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

  it('shows confirmed review transitions and sanitized public detail with exact work refs', () => {
    const ref = { kind: 'day-task', id: 'a'.repeat(64) }
    expect(isValidWorkRef(ref)).toBe(true)
    expect(isValidWorkRef({ ...ref, title: 'must not enter the durable work reference' })).toBe(false)
    const digest = getNotificationDigestPresentation([
      { eventType: 'review.changed', workRef: ref, fields: { childName: 'Ученик А', subject: 'Спецкурс', title: 'Книги', status: 'needs-fix', previousStatus: 'waiting', nextStep: 'Добавь объяснение <второго случая> https://private.example/token=abc' } },
      { eventType: 'review.changed', workRef: ref, fields: { childName: 'Ученик А', subject: 'Спецкурс', title: 'Периметр', status: 'verified', previousStatus: 'needs-fix', summary: 'Проверено.' } },
    ])
    expect(digest.header).toBe('Ученик А · 2 изменения')
    expect(digest.context).toBe('Спецкурс')
    expect(digest.entries[0].text).toContain('Ожидало проверки → нужна правка')
    expect(digest.entries[0].text).toContain('[ссылка скрыта]')
    expect(digest.entries[1].text).toContain('Нужна правка → проверено')
    expect(digest.entries.map(entry => entry.workRef)).toEqual([ref, ref])
    expect(getNotificationDigestPresentation([{ eventType: 'upload.confirmed', fields: { title: 'Работа', photoCount: 12 } }]).text).not.toContain('12')
    expect(getNotificationDigestPresentation([{ eventType: 'grade.created', fields: { value: '5' } }]).text).toContain('📝')
  })

  it('groups only distinct confirmed uploads with the same exact valid work reference', () => {
    const workA = { kind: 'day-task', id: 'a'.repeat(64) }
    const workB = { kind: 'day-task', id: 'b'.repeat(64) }
    const upload = (eventId, workRef, detectedAt = '2026-10-18T10:00:00.000Z') => ({
      eventType: 'upload.confirmed', eventId, detectedAt, workRef,
      fields: { childName: 'Ученик А', subject: 'Математика', title: 'Задача 64' },
    })
    const digest = getNotificationDigestPresentation([
      upload('1'.repeat(64), workA), upload('2'.repeat(64), workA), upload('3'.repeat(64), workA),
      upload('2'.repeat(64), workA), upload('4'.repeat(64), workB),
      { eventType: 'upload.confirmed', eventId: '5'.repeat(64), fields: { title: 'Без связи' } },
      { eventType: 'upload.confirmed', workRef: workA, fields: { title: 'Старое событие' } },
    ])
    expect(digest.changeCount).toBe(6)
    expect(digest.header).toBe('6 изменений')
    expect(digest.entries).toHaveLength(4)
    expect(digest.entries.map((entry) => entry.uploadCount)).toEqual([3, 1, 1, 1])
    expect(digest.entries[0].workOrders).toEqual([
      `2026-10-18T10:00:00.000Z:${'1'.repeat(64)}`,
      `2026-10-18T10:00:00.000Z:${'2'.repeat(64)}`,
      `2026-10-18T10:00:00.000Z:${'3'.repeat(64)}`,
    ])
    expect(digest.entries.map((entry) => entry.workRef?.id ?? null)).toEqual([workA.id, workB.id, null, workA.id])
    expect(digest.entries[0].text).toContain('получено 3 файла · ждут проверки')
    expect(digest.text.match(/Задача 64/g)).toHaveLength(2)
  })

  it('does not infer shared due context or homework changes from missing before values', () => {
    const digest = getNotificationDigestPresentation([
      { eventType: 'homework.changed', fields: { childName: 'Ученик А', subject: 'Математика', title: '№120, 121, 122', previousTitle: '№120, 121', occurredLabel: 'К понедельнику' } },
      { eventType: 'homework.assigned', fields: { childName: 'Ученик А', subject: 'Математика', title: 'Стр. 18' } },
    ])
    expect(digest.context).toBe('Математика')
    expect(digest.entries[0].text).toContain('📅')
    expect(digest.entries[0].text).toContain('Было: №120, 121')
    expect(digest.entries[0].text).toContain('Стало: №120, 121, 122')
    expect(digest.text).toContain('К понедельнику')
    const mixedDates = getNotificationDigestPresentation([
      { eventType: 'grade.created', fields: { value: '5', occurredLabel: '16 октября' } },
      { eventType: 'grade.created', fields: { value: '4', occurredLabel: '17 октября' } },
    ])
    expect(mixedDates.context).toBe('')
    expect(mixedDates.entries.map(entry => entry.text)).toEqual(expect.arrayContaining([expect.stringContaining('16 октября'), expect.stringContaining('17 октября')]))
    const event = index => ({ eventType: 'review.changed', fields: { childName: 'Ученик А', subject: 'Математика', title: `№${index}`, status: 'verified' } })
    expect(getNotificationDigestPresentation(Array.from({ length: 21 }, (_, index) => event(index))).header).toBe('Ученик А · 21 изменение')
    expect(getNotificationDigestPresentation(Array.from({ length: 22 }, (_, index) => event(index))).header).toBe('Ученик А · 22 изменения')
  })
})
