import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import WorkReview from './WorkReview'

describe('карточка требований МЭШ', () => {
  it('считает ожидание проверки от подтверждения байтов, а legacy без времени оставляет неизвестным', () => {
    const now = Date.now()
    const timestamp = (millis: number) => ({ toMillis: () => millis })
    const upload = { id: 'day:photo', taskId: 'task', status: 'pending',
      createdAt: timestamp(now - 60 * 60_000), storage: { syncedAt: timestamp(now - 6 * 60_000) } } as unknown as DayUpload
    const time = (html: string) => html.match(/<time[^>]*>(.*?)<\/time>/)?.[1]
    const receivedHtml = renderToStaticMarkup(<WorkReview uploads={[upload]} />)
    expect(time(receivedHtml)).toMatch(/^\d+ мин/)
    expect(time(receivedHtml)).not.toContain('ч')

    const legacyHtml = renderToStaticMarkup(<WorkReview uploads={[{ ...upload, storage: undefined }]} />)
    expect(time(legacyHtml)).toBe('Время уточняется')
  })

  it('использует фактическое startedAt, пока разбор активен', () => {
    const now = Date.now()
    const timestamp = (millis: number) => ({ toMillis: () => millis })
    const upload = { id: 'day:photo', taskId: 'task', status: 'pending',
      createdAt: timestamp(now - 60 * 60_000), storage: { syncedAt: timestamp(now - 45 * 60_000) } } as unknown as DayUpload
    const review = { id: 'review', taskId: 'task', processing: { phase: 'review', label: 'Проверяем работу',
      uploadIds: ['photo'], startedAt: timestamp(now - 30_000), updatedAt: timestamp(now) } } as DayWorkReview
    const html = renderToStaticMarkup(<WorkReview uploads={[upload]} review={review} />)
    const elapsed = html.match(/<time[^>]*>(.*?)<\/time>/)?.[1]
    expect(elapsed).toMatch(/^\d+ с$/)
  })

  it.each([false, true])('сохраняет читаемые пробелы в старом разборе, parent=%s', (parent) => {
    const html = renderToStaticMarkup(<WorkReview parent={parent} uploads={[]} review={{
      id: 'spacing', taskId: 'problem-8', status: 'partial',
      studentFeedback: { title: 'Проверь №8',
        confirmed: '30×29:2 ты вычислил верно:эта формула считает пары из30объектов.',
        focus: 'В условии отмечены также оба конца отрезка,а в твоей формуле взято30точек.',
        question: 'Сколько отмеченных точек от0до30,если учесть оба конца?' },
    }} />)
    expect(html).toContain('30 × 29 : 2 ты вычислил верно: эта формула считает пары из 30 объектов.')
    expect(html).toContain('отрезка, а в твоей формуле взято 30 точек.')
    expect(html).toContain('от 0 до 30, если учесть оба конца?')
    expect(html).not.toContain('Уже получилось')
    expect(html).not.toContain('Проверь здесь')
    expect(html).not.toContain('Один вопрос')
  })

  it('форматирует историю, сохраняя дословное свидетельство и исходные данные', () => {
    const review = { id: 'review', taskId: 'problem-8', status: 'verified' as const,
      history: [{ status: 'partial' as const, studentFeedback: { title: 'Попытка №8', confirmed: 'Начало верно', focus: 'Проверь число30точек.', question: 'Какие концы?' } }],
      assessmentBasis: { grade: 6, schoolYear: '2026/27', requirement: 'Условие учителя', observed: '30×29:2=435', comparison: 'Запись сохранена', outcome: 'met' as const, sources: [] },
    }
    const before = JSON.stringify(review)
    const html = renderToStaticMarkup(<WorkReview parent uploads={[]} review={review} />)
    expect(html).toContain('Попытка № 8')
    expect(html).toContain('Проверь число 30 точек.')
    expect(html).toContain('30×29:2=435')
    expect(JSON.stringify(review)).toBe(before)
  })

  it('показывает выполненный номер и неизвестный отдельно, даже при общем тексте обратной связи', () => {
    const html = renderToStaticMarkup(<WorkReview uploads={[]} review={{ id: 'review', taskId: 'mesh-218-223', status: 'cannot-assess',
      studentFeedback: { title: 'Один номер виден', confirmed: '№ 218 сделан', focus: '№ 223 за кадром', question: 'Можно увидеть № 223?' },
      requirementChecks: [
        { id: 'mesh-218', action: '№ 218 · выписать сравнения', meshExcerpt: 'Назначены № 218 и № 223', materialExcerpt: 'Найдите сравнения', evidence: { state: 'visible', uploadId: 'photo-1', observation: 'Список виден' }, result: 'confirmed', explanation: 'Переписывать не нужно' },
        { id: 'mesh-223', action: '№ 223 · выписать олицетворения', meshExcerpt: 'Назначены № 218 и № 223', materialExcerpt: 'Найдите олицетворения', evidence: { state: 'outside-frame', uploadId: 'photo-2', observation: 'Запись за краем кадра' }, result: 'unknown', explanation: 'Покажи только № 223' },
      ] }} />)
    expect(html).toContain('Подтверждено 1 из 2 обязательных пунктов')
    expect(html).toContain('Требование выполнено')
    expect(html).toContain('Не можем установить по фото')
    expect(html).toContain('Учебник уточняет')
    expect(html).toContain('Покажи только № 223')
  })
})
