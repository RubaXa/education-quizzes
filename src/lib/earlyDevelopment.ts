/** @see ../../docs/modules/families/early-development.md */
export const PROGRAM_VERSION = 'first-weeks-2026-10-22'
export const JOURNAL_KEY = 'education-early-preview-journal-v1'
export const reactions = ['Смотрела', 'Отвернулась', 'Уснула', 'Не заметили реакции', 'Другое'] as const
export type Reaction = typeof reactions[number]
export type Observation = { id: string; activityId: string; programVersion: string; observedAt: string; updatedAt?: string; reaction: Reaction; note: string }
export const sources = {
  ccd: { title: 'ВОЗ / ЮНИСЕФ · игра и общение', url: 'https://www.unicef.org/documents/care-child-development' },
  vision: { title: 'AAP · зрение новорождённого', url: 'https://www.healthychildren.org/English/ages-stages/baby/Pages/Babys-Vision-Development.aspx' },
  cues: { title: 'NHS · сигналы ребёнка', url: 'https://www.nhs.uk/best-start-in-life/baby/baby-basics/bonding-with-your-baby/understanding-your-baby/' },
}
export const activities = [
  { id: 'voice', title: 'Знакомый голос', area: 'Общение', materials: 'Только вы',
    intro: 'Расскажите малышу, что вы сейчас делаете.',
    steps: ['Выберите момент спокойного бодрствования. Устройтесь удобно рядом с малышом.', 'Негромко скажите несколько обычных фраз. Сделайте паузу и понаблюдайте.'],
    notice: 'Было ли заметно какое-то изменение во взгляде, движениях или звуках? Отсутствие заметной реакции тоже можно записать.',
    stop: 'Если малыш отворачивается, засыпает или начинает беспокоиться — сделайте паузу. При плаче прекратите игру и помогите ему успокоиться.', source: 'ccd' as const },
  { id: 'face', title: 'Ваше лицо рядом', area: 'Контакт и зрение', materials: 'Только вы',
    intro: 'Дайте малышу спокойно рассмотреть ваше лицо.',
    steps: ['Когда малыш спокойно бодрствует, расположите лицо примерно в 20–30 см от его глаз, не нависая и не касаясь лица.', 'Побудьте рядом, мягко поговорите и дайте время посмотреть. Не нужно добиваться фиксации взгляда.'],
    notice: 'Куда был направлен взгляд? Можно описать то, что вы увидели, без проверки навыка.',
    stop: 'Отворачивается, засыпает или беспокоится — заканчивайте. Не будите ради игры.', source: 'vision' as const },
  { id: 'contrast', title: 'Одна контрастная картинка', area: 'Зрительное знакомство', materials: 'Бумажная картинка или раскладушка',
    intro: 'Если хочется попробовать карточки — начните с одной.',
    steps: ['Выберите спокойное бодрствование. Держите одну простую чёрно-белую картинку примерно в 20–30 см от глаз.', 'Предложите рассмотреть её без быстрой смены изображений. Нескольких спокойных мгновений достаточно для знакомства; обязательной длительности нет.'],
    notice: 'Посмотрел, отвёл взгляд или вы ничего не заметили? Это наблюдение об одном моменте, а не оценка зрения или интеллекта.',
    stop: 'При отворачивании, сонливости или беспокойстве уберите картинку. Взрослый держит её в руках; не оставляйте раскладушку в месте сна.', source: 'vision' as const },
]
export function suggestedActivities(entries: Observation[]) {
  // A recorded disengagement offers a gentler alternative, never a developmental score.
  const latest = [...entries].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
  return latest?.activityId === 'contrast' && latest.reaction === 'Отвернулась'
    ? { items: activities, reason: 'В последней записи о картинке малыш отвернулся. Можно попробовать знакомый голос или просто побыть рядом. Повторять картинку сейчас необязательно.' }
    : { items: activities, reason: 'Выберите одну идею по настроению. Повторять знакомое можно; делать всё по списку не нужно.' }
}
export function readObservations(storage: Pick<Storage, 'getItem'>): Observation[] {
  const raw = storage.getItem(JOURNAL_KEY)
  if (!raw) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || data.some((item) => !item || typeof item.id !== 'string' || !activities.some((a) => a.id === item.activityId)
    || typeof item.programVersion !== 'string' || typeof item.observedAt !== 'string' || !Number.isFinite(Date.parse(item.observedAt))
    || !reactions.includes(item.reaction) || typeof item.note !== 'string')) throw new Error('invalid-journal')
  return data
}
export function writeObservations(storage: Pick<Storage, 'setItem'>, entries: Observation[]) {
  storage.setItem(JOURNAL_KEY, JSON.stringify(entries))
}
