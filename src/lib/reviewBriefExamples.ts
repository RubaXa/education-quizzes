/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
/** Synthetic presentation fixtures only; no learner attempts or new assignments.
 * @see ../../docs/shared/design/compact-review.md#showcase */
/** @see ../../docs/decisions/compact-review-ui-kit-2026-10-31.md */
import type { ReviewBriefData } from '@/components/ReviewBrief'
import type { DayWorkReview } from '@/lib/dayStore'

export function reviewBriefWorkExample(data:ReviewBriefData):DayWorkReview {
 return {id:data.id,taskId:'demo-only',status:data.status==='verified'?'verified':data.status==='uncertain'?'cannot-assess':data.status==='incorrect'?'needs-fix':'partial',studentFeedback:{title:data.label,confirmed:data.confirmed??'',focus:data.focus??'',bridge:data.bridge,question:data.question??'',presentation:{version:1,visual:data.visual,details:data.details??(data.detail?[data.detail]:[])}}}
}

export const reviewBriefExamples: { name: string; data: ReviewBriefData }[] = [
  { name: 'Математика', data: {
    id: 'demo-review-math', label: 'Математика · пример', status: 'revise',
    confirmed: '3 + 2 = 5 — синие карандаши найдены.',
    focus: 'В ответе пока только синие карандаши.',
    visual: { kind: 'facts', label: 'Известные количества карандашей', items: [{ label: 'Красные', value: '3' }, { label: 'Синие', value: '5' }] },
    question: 'Сколько карандашей всего?',
    details: [
      { label: 'Что нужно найти', text: 'В коробке 3 красных карандаша, а синих на 2 больше. Вопрос относится ко всем карандашам в коробке. Число синих уже найдено; эту часть переписывать не нужно.' },
      { label: 'Проверка найденного', visual: { kind: 'comparison', label: 'Проверка уже найденного количества синих карандашей', columns: ['Красные', 'На сколько больше', 'Синие'], rows: [['3', '2', '5']] }, text: 'Количество синих уже подтверждено. Оно на два больше количества красных.' },
    ],
  } },
  { name: 'Русский', data: {
    id: 'demo-review-russian', label: 'Русский язык · пример', status: 'revise',
    confirmed: 'Подлежащее «берёза» найдено верно.',
    focus: 'Проверь согласование выделенных слов.',
    visual: { kind: 'annotation', label: 'В предложении отмечены сказуемое и подлежащее', parts: [{ text: 'В лесу ' }, { text: 'росли', mark: 'focus' }, { text: ' высокая ' }, { text: 'берёза', mark: 'reference' }, { text: '.' }] },
    bridge: 'Подлежащее и сказуемое согласуются в числе.',
    question: 'В каком числе здесь подлежащее?',
    detail: { label: 'Как найти подлежащее', text: 'Найди слово, которое отвечает на вопрос «кто?» или «что?». Затем установи, один предмет назван или несколько.' },
  } },
  { name: 'История', data: {
    id: 'demo-review-history', label: 'История · пример', status: 'revise',
    confirmed: 'Обе даты записаны верно.',
    focus: 'Осталось определить промежуток между событиями.',
    visual: { kind: 'timeline', label: 'Две даты из условного ответа', events: [{ date: '1703', label: 'Основание Петербурга' }, { date: '1721', label: 'Провозглашение империи' }] },
    question: 'Сколько лет прошло между событиями?',
    detail: { label: 'Как читать ленту', text: 'Слева более ранняя дата, справа более поздняя. Расстояние на этой схеме условное: числа лет не заменяются длиной линии.' },
  } },
]

export const reviewBriefVerified: ReviewBriefData = { id: 'demo-review-verified', label: 'Проверка · пример', status: 'verified', confirmed: 'Ответ и объяснение подтверждены.' }
export const reviewBriefUncertain: ReviewBriefData = { id: 'demo-review-uncertain', label: 'Проверка · пример', status: 'uncertain', confirmed: 'Начало записи читается.', focus: 'Последняя строка на снимке неразборчива.', question: 'Пришли чёткий фрагмент последней строки.' }
