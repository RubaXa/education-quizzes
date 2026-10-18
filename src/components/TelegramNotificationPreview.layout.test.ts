import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { getNotificationDigestPresentation, type NotificationEvent } from '../../packages/education-presentation/notification.mjs'

/** @see ../../docs/shared/design/telegram.md#компактная-сводка */
const review = (title: string, status: string): NotificationEvent => ({
  eventType: 'review.changed', source: 'demo', fields: { childName: 'Ученик А', subject: 'Математика', title, status },
})

it('fits three short task entries into a compact shared production digest', () => {
  const digest = getNotificationDigestPresentation([
    review('№3 · Шестьдесят горшков', 'verified'),
    review('№1 · Книги на полках', 'needs-fix'),
    review('№5 · Периметр прямоугольника', 'verified'),
  ])
  expect(digest?.text.split('\n')).toEqual([
    'Ученик А · 3 изменения',
    'Математика',
    '🟢 №3 · Шестьдесят горшков — проверено',
    '🟠 №1 · Книги на полках — нужна правка',
    '🟢 №5 · Периметр прямоугольника — проверено',
  ])
  expect(digest?.text).not.toMatch(/\n{2,}|Education|Проверка работы/)
})

it('shows a linked upload and review history in the demo and never attaches a UI Kit action', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'TelegramNotificationPreview.tsx'), 'utf8')
  expect(source).toContain('История одной работы')
  expect(source).toContain('linkedHistoryEvents().map')
  expect(source).toContain('previous.detail')
  expect(source).toContain('Не объяснён второй случай.')
  expect(source).not.toContain('#/ui-kit')
})

it('keeps long names and task titles available while wrapping at 320px', () => {
  const childName = 'Александр Иванов — демонстрационное имя с длинной подписью'
  const title = '№3 · Проверить и решить задания по теме «Сложение многозначных чисел с переходом через разряд» и записать подробное решение в тетрадь'
  const digest = getNotificationDigestPresentation([{
    ...review(title, 'needs-fix'), fields: { childName, subject: 'Математика: многозначные числа и действия с величинами', title, status: 'needs-fix', occurredLabel: 'К четвергу, 22 октября' },
  }])
  expect(digest?.text).toContain(childName)
  expect(digest?.text).toContain(title)

  const css = readFileSync(resolve(import.meta.dirname, 'TelegramNotificationPreview.css'), 'utf8')
  const message = css.match(/\.edu-telegram-message\s*\{([^}]*)\}/)?.[1] ?? ''
  const text = css.match(/\.edu-telegram-message-text\s*\{([^}]*)\}/)?.[1] ?? ''
  const header = css.match(/\.edu-telegram-message-header\s*\{([^}]*)\}/)?.[1] ?? ''
  expect(message).toContain('min-width:0')
  expect(message).toContain('width:min(100%,520px)')
  expect(text).toContain('font-size:1rem')
  expect(text).toContain('font-weight:400')
  expect(header).toContain('font-weight:700')
  expect(text).toContain('white-space:pre-wrap')
  expect(text).toContain('overflow-wrap:anywhere')
  expect(text).toContain('word-break:break-word')
  expect(css).toContain('@media(max-width:420px)')
})

it('omits contextless review events instead of producing an empty status message', () => {
  const digest = getNotificationDigestPresentation([review('', 'needs-fix')])
  expect(digest).toBeNull()
})
