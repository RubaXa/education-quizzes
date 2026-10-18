import { useMemo, useState } from 'react'
import { Award, Bell, Calendar, Camera, ExternalLink, FileText, FlaskConical, Search } from 'lucide-react'
import { getNotificationPresentation, NOTIFICATION_EXAMPLES } from '../../packages/education-presentation/notification.mjs'
import StatusIcon from './StatusIcon'
import './TelegramNotificationPreview.css'

/** @see ../../docs/shared/design/telegram.md#визуальная-система */
type ContentMode = 'short' | 'long' | 'no-context'
const localPreviewAction = { label: 'Посмотреть пример', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit' }
const eventIcons = { Camera, FileText, Award, Search, Calendar, FlaskConical, Bell }

const longText = 'Проверить и решить задания по теме «Сложение многозначных чисел с переходом через разряд» — № 12, 13 и 14 на странице 128; записать решение в тетрадь и проверить вычисления обратным действием.'

export default function TelegramNotificationPreview() {
  const [exampleId, setExampleId] = useState('upload')
  const [contentMode, setContentMode] = useState<ContentMode>('short')
  const [feedback, setFeedback] = useState('')
  const example = NOTIFICATION_EXAMPLES.find(item => item.id === exampleId) ?? NOTIFICATION_EXAMPLES[0]
  const event = useMemo(() => {
    const fields = { ...example.event.fields }
    if (contentMode === 'long') {
      fields.childName = 'Ученик А — демонстрационное имя с длинной подписью'
      fields.subject = 'Математика: многозначные числа и действия с величинами'
      fields.title = longText
      fields.occurredLabel = 'Задание к 2026-10-22'
    }
    if (contentMode === 'no-context') {
      delete fields.childName
      delete fields.subject
      delete fields.title
      delete fields.value
      delete fields.occurredLabel
    }
    return { ...example.event, fields }
  }, [contentMode, example])
  const presentation = getNotificationPresentation(event, {
    demo: true,
    action: contentMode === 'no-context' ? null : localPreviewAction,
  })
  const EventIcon = eventIcons[presentation.eventIcon as keyof typeof eventIcons] ?? Bell

  return <section aria-labelledby="telegram-preview-title" className="edu-telegram-kit">
    <h2 id="telegram-preview-title">Telegram-уведомления</h2>
    <p>Демонстрационные события проходят через общую модель уведомлений. Пример действия показывает локальный отклик.</p>
    <div className="edu-telegram-controls">
      <label>Шаблон<select aria-label="Шаблон уведомления" value={exampleId} onChange={event => { setExampleId(event.target.value); setFeedback('') }}>
        {NOTIFICATION_EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label>Содержание<select aria-label="Содержание уведомления" value={contentMode} onChange={event => { setContentMode(event.target.value as ContentMode); setFeedback('') }}>
        <option value="short">Короткое</option><option value="long">Длинное</option><option value="no-context">Без контекста</option>
      </select></label>
    </div>
    <div className="edu-telegram-stage">
      <article className="edu-telegram-message" aria-label={`Предпросмотр: ${presentation.headline}`}>
        <div className="edu-telegram-message-heading"><span className="edu-telegram-event-icon" data-event-icon={presentation.eventIcon} aria-hidden="true"><EventIcon size={17} /></span><h3>{presentation.headline}</h3></div>
        {(presentation.childName || presentation.subject) && <div className="edu-telegram-meta">
          {presentation.childName && <span>{presentation.childName}</span>}
          {presentation.subject && <span>{presentation.subject}</span>}
        </div>}
        {(presentation.title || presentation.value) && <p className="edu-telegram-primary-content">{presentation.title && <strong>{presentation.title}</strong>}{presentation.value && <strong className="edu-telegram-value">Оценка: {presentation.value}</strong>}</p>}
        {presentation.occurredLabel && <time className="edu-telegram-date">{presentation.occurredLabel}</time>}
        {presentation.status && <div className={`edu-telegram-status edu-telegram-tone-${presentation.status.tone}`} data-status={presentation.status.id}>
          <StatusIcon status={presentation.status.id} size={16} /><span>{presentation.status.label}</span>
        </div>}
        {presentation.action && <button className="edu-telegram-action" type="button" onClick={event => { event.preventDefault(); setFeedback('Это демонстрация: переход не выполняется.') }}>
          {presentation.action.label}<ExternalLink size={15} aria-hidden="true" />
        </button>}
      </article>
      <p className="edu-telegram-demo-note">Демонстрация. Реальный вид зависит от темы Telegram</p>
      {feedback && <p role="status" className="edu-telegram-feedback">{feedback}</p>}
    </div>
  </section>
}
