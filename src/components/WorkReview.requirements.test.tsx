import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkReview from './WorkReview'

describe('карточка требований МЭШ', () => {
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
