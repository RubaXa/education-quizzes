// @see ../../docs/product/card-generation-policy.md#source-inventory
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DayProblem } from '@/lib/dayStore'
import ProblemTaskCard from './ProblemTaskCard'

describe('one upload action per numbered problem', () => {
  it('keeps the upload control on the second variant and after a completed review', () => {
    for (const [variantId, tone] of [['mesh-1-v1', 'ready'], ['mesh-1-v2', 'verified']] as const) {
      const problem = { id: `mesh-1-p-${variantId}-1`, number: 1, variantId,
        title: 'Задача', detail: 'Решить', source: 'Лист учителя',
        original: { text: '№ 1. Решить задачу.', attachmentRef: 'mesh-attachment:sheet#1' },
      } as DayProblem
      const html = renderToStaticMarkup(<ProblemTaskCard problem={problem}
        state={{ tone, label: tone === 'verified' ? 'Подтверждено' : 'Можно приступить' }}
        links={[]} parent={false} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
      expect(html).toContain('Добавить фото')
      expect(html).toContain(`id="${problem.id}"`)
    }
  })
})
