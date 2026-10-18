export type EducationStatus = 'ready' | 'started' | 'uploading' | 'waiting' | 'processing' | 'paused' | 'complete' | 'partial' | 'needs-fix' | 'incorrect' | 'unknown' | 'failed' | 'new'
export type StatusPresentation = Readonly<{ id: EducationStatus; label: string; tone: 'neutral' | 'accent' | 'success' | 'attention' | 'waiting' | 'error'; emoji: string; icon: string }>
export type NotificationAction = Readonly<{ label: string; url: string }>
export type NotificationEvent = { eventType?: string; source?: string; navigationContext?: { kind: 'day'; dayToken: string }; fields?: Record<string, unknown>; [key: string]: unknown }
export type NotificationPresentation = { eventType: string; headline: string; eventIcon: 'Camera' | 'FileText' | 'Award' | 'Search' | 'Calendar' | 'FlaskConical' | 'Bell'; eventEmoji: string; childName: string | null; subject: string | null; title: string | null; occurredLabel: string | null; status: StatusPresentation | null; value: string | null; reviewChangeKind: 'updated' | null; action: NotificationAction | null; demo: boolean }
export type NotificationDigestPresentation = { childName: string | null; subject: string | null; text: string; entries: ReadonlyArray<{ eventType: string; childName: string | null; subject: string | null; eventEmoji: string; headline: string; title: string | null; value: string | null; occurredLabel: string | null; reviewChangeKind: 'updated' | null; status: { id: EducationStatus; label: string; emoji: string } | null }> }
export const STATUS_PRESENTATION: Readonly<Record<EducationStatus, StatusPresentation>>
export const NOTIFICATION_EXAMPLES: ReadonlyArray<{ id: string; label: string; event: NotificationEvent }>
export function getNotificationPresentation(event: NotificationEvent, options?: { demo?: boolean; action?: NotificationAction | null }): NotificationPresentation
export function getNotificationDigestPresentation(events: ReadonlyArray<NotificationEvent>): NotificationDigestPresentation | null
export function validateNotificationAction(action: unknown, options?: { demo?: boolean }): NotificationAction | null
export function isValidEducationDayToken(value: unknown): value is string
