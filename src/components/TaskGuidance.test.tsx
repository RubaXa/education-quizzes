import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TaskGuidance from './TaskGuidance'

describe('learner guidance disclosure', () => {
  it('shows the selected full stage with rows, rationale and public source label, without private source metadata', () => {
    const html = renderToStaticMarkup(<TaskGuidance items={[{
      id: 'release', taskId: 'task', stageId: 'transition', stageIndex: 0, level: 'reveal',
      text: 'Сохраняем короткое пояснение.', guideRevision: 2, actorPersonId: 'parent', createdAt: null,
      revealContent: {
        title: 'Прямая и направления', expected: 'Переходы ±1, ±2, ±4, ±8, ±16 дм',
        rows: [{ label: 'Симметрия', value: 'Можно считать последний переход равным +16' }],
        role: 'calculation', why: 'Направление противоположно.', answer: '', verification: [], sourceLabel: 'Лист учителя №2',
      },
    }]} />)
    expect(html).toContain('Прямая и направления')
    expect(html).toContain('Симметрия')
    expect(html).toContain('Можно считать последний переход равным +16')
    expect(html).toContain('Лист учителя №2')
    expect(html).not.toContain('private-ref')
    expect(html).not.toContain('private-excerpt')
    expect(html).not.toContain('Соседний ответ')
  })

  it('keeps hints prose-only and supports legacy prose-only reveal events', () => {
    const html = renderToStaticMarkup(<TaskGuidance items={[
      { id: 'hint', taskId: 'task', stageId: 'a', stageIndex: 0, level: 'hint', text: 'Посмотри на направление.', guideRevision: 1, actorPersonId: 'p', createdAt: null },
      { id: 'legacy', taskId: 'task', stageId: 'b', stageIndex: 1, level: 'reveal', text: 'Старый полный шаг.', guideRevision: 1, actorPersonId: 'p', createdAt: null },
    ]} />)
    expect(html).toContain('Посмотри на направление.')
    expect(html).toContain('Старый полный шаг.')
    expect(html).not.toContain('Источник:')
  })

  it('shows a hint and later reveal as one stage card with the complete reveal', () => {
    const html = renderToStaticMarkup(<TaskGuidance items={[
      { id: 'hint', taskId: 'task', stageId: 'a', stageIndex: 0, level: 'hint', text: 'Посмотри на направление.', guideRevision: 1, actorPersonId: 'p', createdAt: { seconds: 1 } },
      { id: 'reveal', taskId: 'task', stageId: 'a', stageIndex: 0, level: 'reveal', text: 'Полный переход.', guideRevision: 1, actorPersonId: 'p', createdAt: { seconds: 2 },
        revealContent: { title: 'Прямая и направления', expected: '±1, ±2, ±4, ±8, ±16 дм', rows: [], role: 'calculation', why: '', answer: '', verification: [], sourceLabel: 'Лист учителя №2' } },
    ]} />)
    expect((html.match(/class="day-learning-route-stage"/g) ?? []).length).toBe(1)
    expect(html.match(/class="day-guidance-release-content"/g)).toHaveLength(1)
    expect(html).toContain('class="day-guidance-previous"')
    expect(html).toContain('Посмотри на направление.')
    expect(html).toContain('Прямая и направления')
    expect(html).toContain('Полный переход.')
  })

  it('uses Firestore nanoseconds to keep reveal current when both levels land within one second', () => {
    const html = renderToStaticMarkup(<TaskGuidance items={[
      { id: 'z-hint', taskId: 'task', stageId: 'a', stageIndex: 0, level: 'hint', text: 'Hint.', guideRevision: 1, actorPersonId: 'p', createdAt: { seconds: 1, nanoseconds: 100 } },
      { id: 'a-reveal', taskId: 'task', stageId: 'a', stageIndex: 0, level: 'reveal', text: 'Reveal.', guideRevision: 1, actorPersonId: 'p', createdAt: { seconds: 1, nanoseconds: 200 },
        revealContent: { title: 'Полный заголовок', expected: 'Ожидаемое', rows: [], role: 'calculation', why: '', answer: '', verification: [], sourceLabel: 'Источник' } },
    ]} />)
    expect(html).toContain('<b>Полный заголовок</b>')
    expect(html).toContain('Reveal.')
    expect(html).toContain('Предыдущая помощь · 1')
  })
})
