import type { InboxNotification } from './educationSchema'
import { lessonSubjectId } from './homeworkStatus'

export type Notice = InboxNotification & { id: string }
export type NotificationThread = { key: string; latest: Notice; items: Notice[]; unread: number }
export type ViewedHomework = { familyId: string; childId: string; date: string; subject: string }

/** A lesson opened outside the bell acknowledges only that child's matching
 * homework news; other children's or subjects' events remain unread. */
export function viewedHomeworkNoticeIds(notices: Notice[], viewed: ViewedHomework): string[] {
  const subjectId = lessonSubjectId(viewed.subject)
  return notices.filter((notice) => !notice.readAt && ['homework_published', 'homework_changed'].includes(notice.type)
    && notice.familyId === viewed.familyId && notice.childId === viewed.childId && notice.date === viewed.date
    && (notice.subject?.trim().toLocaleLowerCase('ru-RU') === viewed.subject.trim().toLocaleLowerCase('ru-RU')
      || subjectId != null && lessonSubjectId(notice.subject ?? '') === subjectId)).map((notice) => notice.id)
}

/** One visible thread for unread updates to the same work. The source events
 * remain immutable and individually addressable for audit and old clients.
 * @see ../../docs/architecture/activity-and-inbox.md#in-app-center
 */
export function notificationThreadKey(notice: Notice): string {
  const scope = `${notice.familyId ?? ''}/${notice.childId ?? ''}`
  if (notice.type === 'product_update') return 'product-update'
  if (notice.type === 'parent_guidance' && notice.taskId) return `${scope}/guidance/${notice.taskId}`
  if (notice.type.startsWith('review_') && notice.taskId) return `${scope}/review/${notice.taskId}`
  if (notice.type.startsWith('homework_') && notice.date && notice.subject) return `${scope}/homework/${notice.date}/${notice.subject}`
  return `notice/${notice.id}`
}

export function groupNotificationThreads(notices: Notice[]): NotificationThread[] {
  const groups = new Map<string, NotificationThread>()
  for (const notice of notices) {
    const key = notificationThreadKey(notice)
    const group = groups.get(key)
    if (group) {
      group.items.push(notice)
      if (!notice.readAt) group.unread++
    } else groups.set(key, { key, latest: notice, items: [notice], unread: notice.readAt ? 0 : 1 })
  }
  return [...groups.values()]
}
