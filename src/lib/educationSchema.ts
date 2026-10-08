/** @see ../../docs/architecture/family-data-model.md#collections */
export type EducationRole = 'parent' | 'student'

export type FamilyMembership = {
  role: EducationRole
  childIds: string[]
  active: boolean
}

export type SourceRevision = {
  sourceSystem: 'mesh' | 'family' | 'education'
  sourceId: string
  sourceRevision: number
  checkedAt: unknown
}

/** @see ../../docs/architecture/family-data-model.md#sync */
export type EducationTask = SourceRevision & {
  id: string
  childId: string
  subjectId: string
  dueDate: string
  title: string
  originalText: string
  explainedText?: string
  publication: 'active' | 'changed' | 'removed'
  evidence: 'photo' | 'test' | 'none'
  materialIds: string[]
}

export type EducationDay = {
  date: string
  timezone: string
  schedule: Array<{ id: string; subjectId: string; startsAt: string; endsAt: string }>
  homeworkTaskIds: string[]
  checkedAt: unknown
  revision: number
}

export type EducationSubmission = {
  taskId: string
  taskSourceRevision: number
  actorUid: string
  createdAt: unknown
  state: 'pending' | 'reviewed' | 'needs-fix' | 'verified'
  storageRef: string
}

export type ScreenAudience = EducationRole
export type ScreenView = 'student-home' | 'parent-home' | 'student-day' | 'parent-day'
export type ScreenBlockType =
  | 'homework-focus'
  | 'day-strip'
  | 'grade-summary'
  | 'day-schedule'
  | 'day-homework'
  | 'notification-list'
  | 'review-queue'

export type ScreenSource =
  | 'nearest-homework'
  | 'week-days'
  | 'recent-grades'
  | 'selected-day-schedule'
  | 'selected-day-homework'
  | 'unread-notifications'
  | 'pending-reviews'

export type ScreenBlock = {
  id: string
  type: ScreenBlockType
  source: ScreenSource
  title: string
  visible?: boolean
}

/** @see ../../docs/architecture/backend-driven-ui.md#manifest */
export type ScreenManifest = {
  schemaVersion: 1
  revision: number
  audience: ScreenAudience
  blocks: ScreenBlock[]
}

const blockSources: Record<ScreenBlockType, ScreenSource> = {
  'homework-focus': 'nearest-homework',
  'day-strip': 'week-days',
  'grade-summary': 'recent-grades',
  'day-schedule': 'selected-day-schedule',
  'day-homework': 'selected-day-homework',
  'notification-list': 'unread-notifications',
  'review-queue': 'pending-reviews',
}

const parentOnlyBlocks = new Set<ScreenBlockType>(['review-queue'])

/**
 * Firestore управляет составом экрана через закрытый набор блоков и источников.
 * Неизвестная версия или произвольный путь не превращаются в исполняемый UI.
 * @see ../../docs/architecture/backend-driven-ui.md#rendering
 */
export function parseScreenManifest(value: unknown, view: ScreenView): ScreenManifest {
  const expectedAudience: ScreenAudience = view.startsWith('parent-') ? 'parent' : 'student'
  if (!value || typeof value !== 'object') throw new Error('Настройки экрана отсутствуют.')
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0 || record.audience !== expectedAudience || !Array.isArray(record.blocks)) {
    throw new Error('Версия настроек экрана не поддерживается.')
  }
  const ids = new Set<string>()
  const blocks = record.blocks.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Некорректный блок экрана.')
    const block = item as Record<string, unknown>
    const type = block.type as ScreenBlockType
    const id = block.id
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(id) || ids.has(id) ||
      !(type in blockSources) || block.source !== blockSources[type] ||
      typeof block.title !== 'string' || block.title.length > 100 ||
      (block.visible !== undefined && typeof block.visible !== 'boolean') ||
      (expectedAudience === 'student' && parentOnlyBlocks.has(type))) {
      throw new Error('Настройки экрана содержат неподдерживаемый блок.')
    }
    ids.add(id)
    return { id, type, source: block.source as ScreenSource, title: block.title, visible: block.visible } as ScreenBlock
  })
  return { schemaVersion: 1, revision: Number(record.revision), audience: expectedAudience, blocks }
}

export type ActivityType =
  | 'page_opened' | 'section_opened' | 'day_opened' | 'task_opened'
  | 'test_started' | 'test_submitted' | 'submission_uploaded' | 'notification_opened'

/** @see ../../docs/architecture/activity-and-inbox.md#events */
export type ActivityEvent = {
  schemaVersion: 1
  actorUid: string
  childId: string
  type: ActivityType
  viewId: ScreenView
  sectionId: string
  entityId: string
  sessionId: string
  occurredAt: unknown
}

/** @see ../../docs/architecture/activity-and-inbox.md#read-state */
export type ViewReceipt = { sourceRevision: number; seenAt: unknown }

export type InboxNotification = {
  familyId: string
  childId: string
  type: 'homework_published' | 'homework_changed' | 'homework_removed' | 'grade_added' | 'review_ready'
  entityId: string
  sourceRevision: number
  createdAt: unknown
  readAt?: unknown
}
