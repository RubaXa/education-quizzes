/* @see ../../docs/decisions/telegram-compact-digest-2026-10-18.md */
import { useMemo, useState } from 'react'
import { getNotificationDigestPresentation, NOTIFICATION_EXAMPLES } from '../../packages/education-presentation/notification.mjs'
import type { NotificationEvent } from '../../packages/education-presentation/notification.mjs'
import './TelegramNotificationPreview.css'

/** @see ../../docs/shared/design/telegram.md#компактная-сводка */
type ContentMode = 'short' | 'long' | 'no-context'
const longText = 'Проверить и решить задания по теме «Сложение многозначных чисел с переходом через разряд» — № 12, 13 и 14 на странице 128; записать решение в тетрадь и проверить вычисления обратным действием.'
const demoWorkRef = { kind: 'day-task' as const, id: 'a'.repeat(64) }

function linkedHistoryEvents(): NotificationEvent[] {
  const fields = { childName: 'Ученик А', subject: 'Спецкурс', title: '№1 · Книги на полках', occurredLabel: 'Задание к 2026-10-22' }
  return [
    { eventType: 'upload.confirmed', source: 'demo', workRef: demoWorkRef, fields },
    { eventType: 'review.changed', source: 'demo', workRef: demoWorkRef, fields: { ...fields, status: 'needs-fix', previousStatus: 'waiting', nextStep: 'Не объяснён второй случай.' } },
    { eventType: 'review.changed', source: 'demo', workRef: demoWorkRef, fields: { ...fields, status: 'verified', previousStatus: 'needs-fix', nextStep: 'Объяснение добавлено. Замечание снято.' } },
  ]
}

function demoEvents(exampleId: string, mode: ContentMode): NotificationEvent[] {
  if (mode === 'no-context') return [{
    eventType: 'review.changed', source: 'demo', fields: { childName: 'Ученик А', subject: 'Математика', status: 'needs-fix' },
  }]
  const example = NOTIFICATION_EXAMPLES.find(item => item.id === exampleId) ?? NOTIFICATION_EXAMPLES[0]
  if (exampleId === 'review') {
    const common = {
      childName: mode === 'long' ? 'Александр Иванов — демонстрационное имя с длинной подписью' : 'Ученик А',
      subject: mode === 'long' ? 'Математика: многозначные числа и действия с величинами' : 'Спецкурс',
      occurredLabel: 'Задание к 2026-10-22',
    }
    const titles = ['№3 · Шестьдесят горшков', '№1 · Книги на полках', '№5 · Периметр']
    return titles.map((sampleTitle, index) => ({
      eventType: 'review.changed', source: 'demo', workRef: index === 1 ? demoWorkRef : { ...demoWorkRef, id: String(index + 1).padStart(64, '0') },
      fields: { ...common, title: mode === 'long' ? `№${index + 1} · ${longText}` : sampleTitle,
        status: index === 1 ? 'needs-fix' : 'verified', ...(index === 1 ? { previousStatus: 'waiting', nextStep: 'Не объяснён второй случай.' } : {}) },
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
  const history = exampleId === 'review' ? linkedHistoryEvents().map((event, index, events) => {
    const current = getNotificationDigestPresentation([event])?.entries[0]
    const previous = index > 0 ? getNotificationDigestPresentation([events[index - 1]])?.entries[0] : null
    const reply = previous ? `${previous.title ?? 'Работа'} · ${previous.detail ?? previous.status?.label ?? 'Фото получено'}` : null
    return { text: current?.text ?? '', time: ['14:10', '14:18', '14:42'][index], reply }
  }) : []

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
      {digest?.text ? <>
        <article className="edu-telegram-message" aria-label={`Предпросмотр сводки: ${digest.childName ?? ''}`}>
          <pre className="edu-telegram-message-text"><strong className="edu-telegram-message-header">{digest.header}</strong>{digest.context && <>{'\n'}<span className="edu-telegram-message-context">{digest.context}</span></>}{'\n'}{digest.entries.map(entry => entry.text).join('\n')}</pre>
        </article>
        {history.length > 0 && <div className="edu-telegram-history" aria-label="Связанная история одной работы">
          <h3>История одной работы</h3>
          <div className="edu-telegram-history-chat">{history.map((item, index) => <article className="edu-telegram-history-bubble" key={index}>
            {item.reply && <div className="edu-telegram-reply">↪ {item.reply}</div>}
            <pre className="edu-telegram-history-text">{item.text}</pre>
            <time>{item.time}</time>
          </article>)}</div>
        </div>}
      </> : <p className="edu-telegram-no-message" role="status">Событие без подтверждённого задания не включено в Telegram-сводку.</p>}
      <p className="edu-telegram-demo-note">Демонстрация. Шрифт и цвета Telegram задаёт выбранная тема клиента.</p>
    </div>
  </section>
}
