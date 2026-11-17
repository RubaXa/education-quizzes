/** @see ../docs/modules/synchronization/task-routing.md#learning-lifecycle */
export type PreparationSlot = { dates: string[]; mode?: 'until-complete'; availableFrom?: string; preparationThrough?: string }
export function activePreparations<T extends PreparationSlot & {kind?:string;title?:string;lessonDate?:string;taskIds:string[]}>(slots:T[],selectedDate:string):T[]
export function preparationVisible(slot: PreparationSlot, selectedDate: string): boolean
export function ensureContinuousPreparation(source: { targetDate: string; subjects?: { name: string; tasks?: { id: string; dueDate?: string; problems?: unknown[] }[] }[]; weekendSlot?: PreparationSlot;controlPreparationSlot?:PreparationSlot }, availableFrom: string): boolean
export function preparationExpiry(record: { artifactPath?: string; kind: string; source?: { date?: string; dayDate?: string } }, windowDates: string[]): string | null
