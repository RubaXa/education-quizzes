/* @see ../../docs/decisions/telegram-compact-digest-2026-10-18.md */
import { useMemo, useState } from 'react'
import { getNotificationDigestPresentation, NOTIFICATION_EXAMPLES } from '../../packages/education-presentation/notification.mjs'
import type { NotificationEvent } from '../../packages/education-presentation/notification.mjs'
import './TelegramNotificationPreview.css'

/** @see ../../docs/shared/design/telegram.md#компактная-сводка */
type ContentMode = 'short' | 'long' | 'no-context'
const longText = 'Проверить и решить задания по теме «Сложение многозначных чисел с переходом через разряд» — № 12, 13 и 14 на странице 128; записать решение в тетрадь и проверить вычисления обратным действием.'

function demoEvents(exampleId: string, mode: ContentMode): NotificationEvent[] {
  if (mode === 'no-context') return [{
    eventType: 'review.changed', source: 'demo', fields: { childName: 'Ученик А', subject: 'Математика', status: 'needs-fix' },
  }]
  const example = NOTIFICATION_EXAMPLES.find(item => item.id === exampleId) ?? NOTIFICATION_EXAMPLES[0]
  if (exampleId === 'review') {
    const titles = ['№3 · Шестьдесят горшков', '№1 · Книги на полках', '№5 · Периметр прямоугольника']
    return titles.slice(0, mode === 'long' ? 1 : 3).map((title, index) => ({
      ...example.event,
      source: 'demo',
      fields: {
        ...example.event.fields,
        childName: mode === 'long' ? 'Александр Иванов — демонстрационное имя с длинной подписью' : 'Ученик А',
        subject: mode === 'long' ? 'Математика: многозначные числа и действия с величинами' : 'Математика',
        title: mode === 'long' ? `№3 · ${longText}` : title,
        status: index === 1 ? 'needs-fix' : 'verified',
        ...(mode === 'long' ? { occurredLabel: 'Задание к 2026-10-22' } : {}),
      },
    }))
  }
  const fields: Record<string, unknown> = { ...example.event.fields, childName: 'Ученик А', subject: 'Математика' }
  if (mode === 'long') {
    fields.childName = 'Александр Иванов — демонстрационное имя с длинной подписью'
    fields.subject = 'Математика: многозначные числа и действия с величинами'
    fields.title = longText
    fields.occurredLabel = 'Задание к 2026-10-22'
  }
  return [{ ...example.event, source: 'demo', fields }]
}

export default function TelegramNotificationPreview() {
  const [exampleId, setExampleId] = useState('review')
  const [contentMode, setContentMode] = useState<ContentMode>('short')
  const digest = useMemo(() => getNotificationDigestPresentation(demoEvents(exampleId, contentMode)), [contentMode, exampleId])

  return <section aria-labelledby="telegram-preview-title" className="edu-telegram-kit">
    <h2 id="telegram-preview-title">Telegram-уведомления</h2>
    <p>Пример использует ту же компактную модель, что и production-сообщение.</p>
    <div className="edu-telegram-controls">
      <label>Шаблон<select aria-label="Шаблон уведомления" value={exampleId} onChange={event => setExampleId(event.target.value)}>
        {NOTIFICATION_EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label>Содержание<select aria-label="Содержание уведомления" value={contentMode} onChange={event => setContentMode(event.target.value as ContentMode)}>
        <option value="short">Короткое</option><option value="long">Длинное</option><option value="no-context">Без контекста</option>
      </select></label>
    </div>
    <div className="edu-telegram-stage">
      {digest?.text ? <article className="edu-telegram-message" aria-label={`Предпросмотр сводки: ${digest.childName ?? ''} ${digest.subject ?? ''}`}>
        <pre className="edu-telegram-message-text">{(digest.childName || digest.subject) && <><strong className="edu-telegram-message-header">{[digest.childName, digest.subject].filter(Boolean).join(' · ')}</strong>{'\n'}</>}{(digest.childName || digest.subject) ? digest.text.split('\n').slice(1).join('\n') : digest.text}</pre>
      </article> : <p className="edu-telegram-no-message" role="status">Событие без подтверждённого задания не включено в Telegram-сводку.</p>}
      <p className="edu-telegram-demo-note">Демонстрация. Шрифт и цвета Telegram задаёт выбранная тема клиента.</p>
    </div>
  </section>
}
