/** @see ../../docs/decisions/review-readability-repair-2026-10-31.md */
/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
/** Synthetic presentation fixtures only; no learner attempts or new assignments.
 * @see ../../docs/shared/design/compact-review.md#showcase */
/** @see ../../docs/decisions/compact-review-ui-kit-2026-10-31.md */
import type { ReviewBriefData } from '@/components/ReviewBrief'
import type { DayWorkReview } from '@/lib/dayStore'

export function reviewBriefWorkExample(data:ReviewBriefData):DayWorkReview {
 return {id:data.id,taskId:'demo-only',status:data.status==='verified'?'verified':data.status==='uncertain'?'cannot-assess':data.status==='incorrect'?'needs-fix':'partial',studentFeedback:{title:data.label,confirmed:data.confirmed??'',focus:data.focus??'',bridge:data.bridge,question:data.question??'',presentation:{version:1,activity:data.activity,visual:data.visual,details:data.details??(data.detail?[data.detail]:[])}}}
}

export const reviewBriefExamples: { name: string; data: ReviewBriefData }[] = [
  { name: 'Математика', data: {
    id: 'demo-review-math', label: 'Собери общую сумму', status: 'revise',
    activity:{kind:'build',label:'Две найденные группы',instruction:'Собери запись из уже известных количеств.',joiner:' + ',tokens:[{id:'red',text:'3'},{id:'blue',text:'5'}]},
    confirmed: '3 + 2 = 5 — синие карандаши найдены.',
    focus: 'В ответе пока только синие карандаши.',
    visual: { kind: 'facts', label: 'Известные количества карандашей', items: [{ label: 'Красные', value: '3' }, { label: 'Синие', value: '5' }] },
    question: 'Сколько карандашей всего?',
    details: [
      { label: 'Что нужно найти', text: 'В коробке 3 красных карандаша, а синих на 2 больше. Вопрос относится ко всем карандашам в коробке. Число синих уже найдено; эту часть переписывать не нужно.' },
      { label: 'Проверка найденного', visual: { kind: 'comparison', label: 'Проверка уже найденного количества синих карандашей', columns: ['Красные', 'На сколько больше', 'Синие'], rows: [{cells:['3', '2', '5']}] }, text: 'Количество синих уже подтверждено. Оно на два больше количества красных.' },
    ],
  } },
  { name: 'Русский', data: {
    id: 'demo-review-russian', label: 'Согласуй слова', status: 'revise',
    activity:{kind:'mark',label:'Твоя строка',instruction:'Выдели слово, которое определяет число сказуемого.',tokens:[{id:'forest',text:'В лесу'},{id:'verb',text:'росли'},{id:'quality',text:'высокая'},{id:'noun',text:'берёза'}]},
    confirmed: 'Подлежащее «берёза» найдено верно.',
    focus: 'Проверь согласование выделенных слов.',
    visual: { kind: 'annotation', label: 'В предложении отмечены сказуемое и подлежащее', parts: [{ text: 'В лесу ' }, { text: 'росли', mark: 'focus' }, { text: ' высокая ' }, { text: 'берёза', mark: 'reference' }, { text: '.' }] },
    bridge: 'Подлежащее и сказуемое согласуются в числе.',
    question: 'В каком числе здесь подлежащее?',
    detail: { label: 'Как найти подлежащее', text: 'Найди слово, которое отвечает на вопрос «кто?» или «что?». Затем установи, один предмет назван или несколько.' },
  } },
  { name: 'История', data: {
    id: 'demo-review-history', label: 'Сравни даты', status: 'revise',
    activity:{kind:'build',label:'Два события',instruction:'Поставь даты в выбранном порядке.',joiner:' → ',tokens:[{id:'first',text:'1703'},{id:'second',text:'1721'}]},
    confirmed: 'Обе даты записаны верно.',
    visual: { kind: 'timeline', label: 'Две даты из условного ответа', events: [{ date: '1703', label: 'Основание Петербурга' }, { date: '1721', label: 'Провозглашение империи' }] },
    question: 'Сколько лет прошло между событиями?',
    detail: { label: 'Как читать ленту', text: 'Слева более ранняя дата, справа более поздняя. Расстояние на этой схеме условное: числа лет не заменяются длиной линии.' },
  } },
]

export const reviewBriefVerified: ReviewBriefData = { id: 'demo-review-verified', label: 'Проверка · пример', status: 'verified', confirmed: 'Ответ и объяснение подтверждены.' }
export const reviewBriefUncertain: ReviewBriefData = { id: 'demo-review-uncertain', label: 'Проверка · пример', status: 'uncertain', confirmed: 'Начало записи читается.', focus: 'Последняя строка на снимке неразборчива.', question: 'Пришли чёткий фрагмент последней строки.' }

/** A realistic pre-migration paragraph exercises the conservative read adapter. */
export const reviewBriefLegacy:DayWorkReview={id:'demo-review-legacy',taskId:'demo-only',status:'partial',studentFeedback:{
 title:'Проверь весь набор',confirmed:'Первый найденный способ зачтён.',
 focus:'В записи проверена одна добавленная цифра. Это ещё не проверка нескольких цифр вместе. Каждое отдельное число может быть меньше десяти, а их сумма — больше. Ограничение для одной цифры не переносится на сумму всего набора. Нужно различать сами цифры, сумму добавленных и сумму всех цифр. Пояснение к записи сохранено полностью: прежнюю попытку не требуется переписывать из-за смены оформления.',
 question:'Какую общую сумму даёт пробный набор?',
 steps:[{stageId:'scope',status:'partial',uploadId:'demo-photo',location:'Нижняя строка листа с несколькими возможными добавлениями',observation:'Вместе с исходными цифрами записана одна новая цифра.',explanation:'Один правильный способ сохраняется. Осталось проверить другие наборы; это не означает, что найденный способ неверен.'}],
},mathReasoning:{answer:'correct',argument:'incomplete'},history:[{status:'partial',studentFeedback:{title:'Прежняя запись',confirmed:'Начало сохранено.',focus:'Проверка прежней записи.',question:'Прежний вопрос.'}}],assessmentBasis:{requirement:'Проверить несколько разных наборов по одному и тому же условию.',observed:'В синтетическом примере записан один набор.',comparison:'Принятый способ сохраняется, полнота ещё не проверена.',outcome:'not-met',sources:[]}}
