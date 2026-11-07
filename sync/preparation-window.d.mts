/** @see ../docs/modules/synchronization/task-routing.md#learning-lifecycle */
export type PreparationSlot = { dates: string[]; mode?: 'until-complete'; availableFrom?: string; preparationThrough?: string }
export function preparationVisible(slot: PreparationSlot, selectedDate: string): boolean
export function ensureContinuousPreparation(source: { targetDate: string; subjects?: { name: string; tasks?: { id: string; dueDate?: string; problems?: unknown[] }[] }[]; weekendSlot?: PreparationSlot }, availableFrom: string): boolean
export function preparationExpiry(record: { artifactPath?: string; kind: string; source?: { date?: string; dayDate?: string } }, windowDates: string[]): string | null
