/** @see ../docs/modules/families/early-development.md */
export type EarlyActivity = { id: string; title: string; area: string; materials: string; intro: string; steps: string[]; notice: string; stop: string; source: 'ccd' | 'vision' | 'cues' }
export type EarlyStage = { id: string; fromMonths: number; title: string; goal: string; activities: EarlyActivity[] }
export type EarlyProgram = { schemaVersion: number; version: string; stages: EarlyStage[] }
export const program: EarlyProgram
