export declare function isExplicitCdzTask(task: { id: string; kind: string; meshText?: string; title?: string }): boolean
export declare function rawMeshKind(description: string): 'written' | 'check'

export declare function hasAssignedPlatformWork(task?:unknown):boolean
export declare function platformAssignmentErrors(task?:unknown):string[]
