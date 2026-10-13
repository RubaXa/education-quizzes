export type MathRouteProfile = 'compact' | 'standard' | 'extended'
export type MathStageRole = 'given' | 'relations' | 'calculation' | 'solution' | 'answer'
export declare const mathRouteProfiles: Readonly<Record<MathRouteProfile, readonly MathStageRole[]>>
export type LanguageRoutePattern = 'spelling' | 'syntax' | 'text-plan' | 'composition'
export declare const languageRoutePatterns: Readonly<Record<LanguageRoutePattern, { kind: 'structured-notes' | 'text-structure'; stages: readonly string[] }>>
export type LearningRoutePattern = LanguageRoutePattern | 'short-interpretation' | 'evidence-response' | 'concept-function' | 'vocabulary-list' | 'written-exercise' | 'source-analysis' | 'map-analysis' | 'source-evidence'
export declare const learningRoutePatterns: Readonly<Record<LearningRoutePattern, { subject?: string; kind: 'structured-notes' | 'text-structure'; stages?: readonly string[]; repeatable?: boolean }>>
export declare function validLearningRoute(subjectId: string, task: { cardPattern?: string; cardPolicyVersion?: number; outputKind?: string }, guide: { presentation?: string; pattern?: string; kind?: string; revision?: number; stages?: { id: string; expected: string; hintPreview: string; revealPreview: string; reviewLabels: string[] }[] } | undefined): boolean
export declare function validLanguageRoute(task: { cardPattern?: string; cardPolicyVersion?: number; outputKind?: string }, guide: { presentation?: string; pattern?: string; kind?: string; revision?: number; stages?: { id: string; expected: string; hintPreview: string; revealPreview: string; reviewLabels: string[] }[] } | undefined): boolean
export declare function mathRouteProfile(guide: { routeProfile?: MathRouteProfile } | undefined): MathRouteProfile
export declare function cardAdapter(subjectId: string, task: { instructionStatus?: { state: string }; outputKind?: string; cardPattern?: string; kind?: string; problems?: unknown[] } | undefined): string
export declare function cardPolicyModules(subjectId: string, task: { instructionStatus?: { state: string }; outputKind?: string; cardPattern?: string; kind?: string; problems?: unknown[] } | undefined): { base: 'assignment-card'; adapter: string; overlays: string[] }
