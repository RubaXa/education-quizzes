import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkReview from './WorkReview'
import type { DayWorkReview } from '@/lib/dayStore'
import { workReviewBrief } from '@/lib/workReviewBrief'

describe('shared compact review', () => {
  it('keeps a legacy wall of explanation available without placing it before the next question', () => {
    const long = 'Одна цифра и сумма нескольких цифр имеют разные ограничения. '.repeat(8)
    const data = workReviewBrief({id:'legacy',taskId:'legacy',status:'partial',studentFeedback:{title:'Проверь набор целиком',confirmed:'Один способ зачтён.',focus:long,question:'Чему равна общая сумма?'}})
    expect(data.focus).toBeUndefined()
    expect(data.details?.some(detail=>detail.text===long.trim())).toBe(true)
    expect(data.question).toBe('Чему равна общая сумма?')
  })
  const review: DayWorkReview = { id: 'review', taskId: 'task', status: 'partial', uploadIds: ['photo'],
    studentFeedback: { title: 'Проверь третий случай', confirmed: 'Два найденных ответа зачтены.',
      focus: 'В двух пунктах перепутаны объяснения.', question: 'Что следует из роли каждого?',
      steps: [{ stageId: 'roles', uploadId: 'photo', location: 'пункт 3', observation: 'Первая запись ученика.', explanation: 'Проверь истинность фразы по роли жителя.', status: 'partial' }] },
    history: [{ status: 'partial', studentFeedback: { title: 'Прежняя попытка', confirmed: 'Начало верно.', focus: 'Прежнее замечание.', question: 'Прежний вопрос.' } }] }
  it.each([false, true])('shows the current question immediately and keeps explanations separate, parent=%s', parent => {
    const html = renderToStaticMarkup(<WorkReview review={review} uploads={[]} parent={parent} />)
    expect(html).toContain('edu-review-brief')
    expect(html.indexOf('Что следует из роли каждого?')).toBeLessThan(html.indexOf('Первая запись ученика.'))
    expect(html).toContain('edu-review-detail')
    expect(html).toContain('Предыдущие попытки')
    expect(html).not.toContain('class="day-work-review-feedback"')
  })
  it('keeps receiving a new file separate from the earlier review and parent completion', () => {
    const html=renderToStaticMarkup(<WorkReview review={review} uploads={[{id:'pending',taskId:'task',status:'pending'}]} accepted parent />)
    expect(html).toContain('Предыдущая проверка')
    expect(html).toContain('Засчитано родителем')
    expect(html).not.toContain('Что следует из роли каждого?')
  })
})
