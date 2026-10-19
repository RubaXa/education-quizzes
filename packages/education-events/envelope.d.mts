export type EducationEventIdentity = {
  eventType: string
  familyId: string
  childId: string
  source: 'firestore' | 'mesh'
  sourceRef: {
    kind: string
    documentPath: string
    dayToken?: string
    recordId?: string
    quizToken?: string
    taskId?: string
  }
  operationId: string
}

export function createEducationEventId(input: EducationEventIdentity): Promise<string>
export function canonicalEducationEventSourceRef(input: EducationEventIdentity['sourceRef']): EducationEventIdentity['sourceRef']
export function createEducationEvent<Timestamp>(input: EducationEventIdentity & {
  actor: { type: 'user'; uid: string } | { type: 'system'; id: string }
}, timestamp: Timestamp): Promise<{
  schemaVersion: 1
  eventId: string
  eventType: string
  familyId: string
  childId: string
  source: 'firestore' | 'mesh'
  sourceRef: EducationEventIdentity['sourceRef']
  operationId: string
  actor: { type: 'user'; uid: string } | { type: 'system'; id: string }
  createdAt: Timestamp
  state: 'pending'
  availableAt: Timestamp
  attempts: 0
}>
