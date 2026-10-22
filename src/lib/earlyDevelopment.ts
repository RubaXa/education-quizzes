/** @see ../../docs/modules/families/early-development.md */
import { program, type EarlyProgram } from '../../early-development/program.mjs'
export { program }
export const PROGRAM_VERSION = program.version
export const JOURNAL_KEY = 'education-early-preview-journal-v1'
export const reactions = ['Смотрела', 'Отвернулась', 'Уснула', 'Не заметили реакции', 'Другое'] as const
export type Reaction = typeof reactions[number]
export type Observation = { id: string; activityId: string; programVersion: string; observedAt: string; updatedAt?: string; revision?: number; revisionId?: string; authorId?: string; createdAt?: unknown; deleted?: boolean; activityTitle?: string; reaction: Reaction; note: string }
export const sources = {
  ccd: { title: 'ВОЗ / ЮНИСЕФ · игра и общение', url: 'https://www.unicef.org/documents/care-child-development' },
  vision: { title: 'AAP · зрение новорождённого', url: 'https://www.healthychildren.org/English/ages-stages/baby/Pages/Babys-Vision-Development.aspx' },
  cues: { title: 'NHS · сигналы ребёнка', url: 'https://www.nhs.uk/best-start-in-life/baby/baby-basics/bonding-with-your-baby/understanding-your-baby/' },
}
export const activities = program.stages[0].activities

export function suggestedActivities(entries: Observation[], choices = activities) {
  // A recorded disengagement offers a gentler alternative, never a developmental score.
  const latest = [...entries].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
  return latest?.activityId === 'contrast' && latest.reaction === 'Отвернулась'
    ? { items: choices, reason: 'В последней записи о картинке малыш отвернулся. Можно попробовать знакомый голос или просто побыть рядом. Повторять картинку сейчас необязательно.' }
    : { items: choices, reason: 'Выберите одну идею по настроению. Повторять знакомое можно; делать всё по списку не нужно.' }
}
export function readObservations(storage: Pick<Storage, 'getItem'>): Observation[] {
  const raw = storage.getItem(JOURNAL_KEY)
  if (!raw) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || data.some((item) => !item || typeof item.id !== 'string' || item.activityId !== 'free-note' && !program.stages.flatMap((stage) => stage.activities).some((a) => a.id === item.activityId)
    || typeof item.programVersion !== 'string' || typeof item.observedAt !== 'string' || !Number.isFinite(Date.parse(item.observedAt))
    || !reactions.includes(item.reaction) || typeof item.note !== 'string')) throw new Error('invalid-journal')
  return data
}
export function writeObservations(storage: Pick<Storage, 'setItem'>, entries: Observation[]) {
  storage.setItem(JOURNAL_KEY, JSON.stringify(entries))
}

/** Calendar age selects suggestions; it is not a developmental measurement. */
export function earlyStage(birthDate: string, curriculum: EarlyProgram = program, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(Date.parse(birthDate)) || birthDate > today || new Date(birthDate).toISOString().slice(0, 10) !== birthDate) return null
  const [y, m, d] = today.split('-').map(Number), [by, bm, bd] = birthDate.split('-').map(Number)
  const months = (y - by) * 12 + m - bm - (d < bd ? 1 : 0)
  const days = Math.floor((Date.parse(today) - Date.parse(birthDate)) / 86400000)
  const stage = [...curriculum.stages].reverse().find((item) => months >= item.fromMonths)
  return stage ? { stage, days, months } : null
}
