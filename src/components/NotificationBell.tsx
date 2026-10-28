/**
 * @see ../../docs/modules/notifications/README.md
 */
import { useEffect, useState } from 'react'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import { Bell, ChevronRight, X } from 'lucide-react'
import { markAllNotificationsRead, markNotificationsRead, watchInbox } from '@/lib/educationStore'
import { readCachedPersonalContext, restorePersonalContext } from '@/lib/personalAccess'
import { readCachedInbox } from '@/lib/inboxCache'
import type { PersonalChild } from '@/lib/personalAccess'
import { groupNotificationThreads, viewedHomeworkNoticeIds } from '@/lib/notificationThreads'
import type { Notice, NotificationThread } from '@/lib/notificationThreads'
import EducationImage from './EducationImage'
import './NotificationBell.css'
import { reportUiError } from '@/lib/uiErrors'

function title(notice: Notice) {
  if (notice.type === 'olympiad_enabled') return 'Родитель включил подготовку к олимпиаде'
  if (notice.title) return notice.title
  if (notice.type === 'homework_published') return 'Появилось домашнее задание'
  if (notice.type === 'homework_changed') return 'Домашнее задание изменилось'
  if (notice.type === 'homework_removed') return 'Домашнее задание снято'
  if (notice.type === 'grade_added') return 'Появилась новая оценка'
  if (notice.type === 'grade_changed') return 'Оценки уточнены'
  if (notice.type === 'school_late') return 'Отмечено опоздание'
  if (notice.type === 'school_remark') return 'Замечание в МЭШ'
  if (notice.type === 'review_started') return 'Начали проверку работы'
  if (notice.type === 'review_paused') return 'Проверка задержана'
  if (notice.type === 'review_updated') return 'Результат работы уточнён'
  if (notice.type === 'parent_accepted') return 'Задача засчитана родителем'
  if (notice.type === 'parent_reopened') return 'Задача снова открыта'
  if (notice.type === 'parent_requirement_mandatory') return 'Родитель назначил доработку'
  if (notice.type === 'parent_requirement_optional') return 'Доработка теперь по желанию'
  if (notice.type === 'parent_guidance') return 'Родитель отправил помощь по задаче'
  if (notice.type === 'product_update') return 'Обновление Education'
  return 'Работа проверена'
}
function NoticeImage({ label, media }: { label: string; media: { publicUrl: string } }) {
  return <figure><EducationImage source={media.publicUrl} mode="public" size="M" alt={`${label} обновления`} aspectRatio="16 / 9" /><figcaption>{label}</figcaption></figure>
}
function detailBody(notice: Notice) {
  if (notice.type === 'olympiad_enabled') return 'Открой олимпиады в своём учебном кабинете.'
  if (notice.body) return notice.body
  if (notice.type === 'parent_accepted') return 'Родитель засчитал верный ответ. Замечание к ходу решения остаётся в карточке.'
  if (notice.type === 'parent_reopened') return 'Родитель снова открыл задачу. Посмотри, что осталось сделать.'
  if (notice.type === 'parent_requirement_mandatory') return 'Открой карточку: там указано, что именно родитель решил доработать.'
  if (notice.type === 'parent_requirement_optional') return 'Родитель снял обязательную доработку. Задание уже предъявлено; можно вернуться к нему по желанию.'
  if (notice.type === 'parent_guidance') return 'Открой задачу: в карточке есть подсказка или показанный шаг.'
  return ''
}
function noticeTime(value: unknown) {
  const millis = typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function' ? value.toMillis() : Date.parse(String(value ?? ''))
  return Number.isFinite(millis) ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(millis)) : ''
}
function todayMoscow() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date())
}

/** @see ../../docs/modules/notifications/inbox.md#in-app-center
 *  @see ../../docs/shared/design/README.md#shell */
export default function NotificationBell({ routeKey }: { routeKey: string }) {
  const sessionRoute = routeKey.startsWith('#/enter/') ? routeKey : 'active'
  const [cachedContext] = useState(() => {
    if (routeKey.startsWith('#/enter/')) return null
    const cached = readCachedPersonalContext()
    const knownUid = getAuth().currentUser?.uid
    return cached && (!knownUid || knownUid === cached.session.deviceUid) ? cached : null
  })
  const [personId, setPersonId] = useState<string | null>(cachedContext?.session.personId ?? null)
  // A cached identity may render immediately, but currentEducationPersonId is
  // available to the inbox query only after the auth/session restore finishes.
  const [subscriptionPersonId, setSubscriptionPersonId] = useState<string | null>(null)
  const [children, setChildren] = useState<PersonalChild[]>(cachedContext?.profile.children ?? [])
  const [items, setItems] = useState<Notice[]>(() => cachedContext ? readCachedInbox(cachedContext.session.personId) : [])
  const [open, setOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [readingAll, setReadingAll] = useState(false)

  useEffect(() => {
    if (sessionRoute !== 'active') return
    let active = true
    const refresh = async () => {
      setSubscriptionPersonId(null)
      try {
        const context = await restorePersonalContext()
        if (!active) return
        setPersonId(context?.session.personId ?? null)
        setChildren(context?.profile.children ?? [])
        setSubscriptionPersonId(context?.session.personId ?? null)
        setError('')
      } catch (cause) { if (active) setError(reportUiError(cause, 'Обновления')) }
    }
    // Auth's initial callback is the initial refresh. Rechecking the whole
    // profile on every ordinary route change was a costly duplicate read.
    const stop = onAuthStateChanged(getAuth(), () => { void refresh() }, (cause) => { if (active) setError(reportUiError(cause, 'Обновления')) })
    return () => { active = false; stop() }
  }, [sessionRoute])

  useEffect(() => {
    if (!personId) { setItems([]); return }
    if (subscriptionPersonId !== personId) return
    try { return watchInbox((next) => { setItems(next); setError('') }, (cause) => setError(reportUiError(cause, 'Обновления'))) }
    catch (cause) { setError(reportUiError(cause, 'Обновления')) }
  }, [personId, subscriptionPersonId])

  useEffect(() => {
    const acknowledgeLesson = (event: Event) => {
      const viewed = (event as CustomEvent<{ dashboardToken?: string; date?: string; subject?: string }>).detail
      if (!viewed?.dashboardToken || !viewed.date || !viewed.subject) return
      const child = children.find((entry) => entry.dashboardToken === viewed.dashboardToken)
      if (!child) return
      const ids = viewedHomeworkNoticeIds(items, { familyId: child.familyId, childId: child.childId,
        date: viewed.date, subject: viewed.subject })
      if (!ids.length) return
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item))
      void markNotificationsRead(ids).catch((cause) => {
        setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, readAt: undefined } : item))
        setError(reportUiError(cause, 'Обновления'))
      })
    }
    window.addEventListener('education-homework-update-seen', acknowledgeLesson)
    return () => window.removeEventListener('education-homework-update-seen', acknowledgeLesson)
  }, [children, items])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setShowHistory(false); setExpanded(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!personId || routeKey.startsWith('#/enter/')) return null
  const threads = groupNotificationThreads(items)
  const unread = threads.filter((thread) => thread.unread > 0).length
  const historyCount = threads.length - unread
  const visibleThreads = threads.filter((thread) => showHistory || thread.unread > 0 || expanded === thread.key)

  async function openNotice(thread: NotificationThread) {
    const ids = thread.items.filter((item) => !item.readAt).map((item) => item.id)
    if (ids.length) setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item))
    try { await markNotificationsRead(ids) }
    catch (cause) {
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, readAt: undefined } : item))
      setError(reportUiError(cause, 'Обновления'))
    }
    setExpanded((current) => current === thread.key ? null : thread.key)
  }

  async function readAll() {
    if (readingAll || subscriptionPersonId !== personId) return
    const visibleUnreadIds = new Set(items.filter((item) => !item.readAt).map((item) => item.id))
    setReadingAll(true); setError('')
    try {
      await markAllNotificationsRead()
      setItems((current) => current.map((item) => visibleUnreadIds.has(item.id) ? { ...item, readAt: new Date().toISOString() } : item))
    } catch (cause) { setError(reportUiError(cause, 'Обновления')) }
    finally { setReadingAll(false) }
  }

  function navigateToNotice(item: Notice) {
    const child = children.find((entry) => entry.childId === item.childId && entry.familyId === item.familyId && entry.dashboardToken)
    if (!child) { setError('Переход к учебному дню ещё не подключён для этого профиля.'); return }
    if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      sessionStorage.setItem('education-dashboard-selected-date', item.date)
      sessionStorage.setItem('education-dashboard-selection-day', todayMoscow())
      if (item.subject) sessionStorage.setItem('education-dashboard-focus-subject', item.subject)
    }
    if (item.taskId) sessionStorage.setItem('education-dashboard-focus-task', item.taskId)
    setOpen(false)
    setShowHistory(false)
    setExpanded(null)
    const target = `#/days/${child.dashboardTokens?.student ?? child.dashboardToken}`
    if (window.location.hash === target) window.dispatchEvent(new Event('education-notification-navigation'))
    else window.location.hash = target
  }

  return <div className="notification-center">
    <button className="notification-bell" type="button" aria-label={`Обновления${unread ? `, непрочитанных: ${unread}` : ''}`} aria-expanded={open} aria-controls="education-notification-list" onClick={() => { setOpen((value) => !value); setShowHistory(false); setExpanded(null) }}>
      <Bell size={20} aria-hidden="true" />{unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section id="education-notification-list" className="notification-panel" aria-label="Обновления Education">
      <header><h2>Обновления</h2><button className="notification-read-all" type="button" disabled={readingAll || subscriptionPersonId !== personId} onClick={() => void readAll()}>{readingAll ? 'Читаем…' : 'Прочитать все'}</button><button className="notification-close" type="button" aria-label="Закрыть обновления" onClick={() => { setOpen(false); setShowHistory(false); setExpanded(null) }}><X size={19} /></button></header>
      {error && <p className="notification-error">{error}</p>}
      {visibleThreads.length ? <ul>{visibleThreads.map((thread) => {
        const item = thread.latest
        return <li key={thread.key}><button type="button" className={`notification-item${thread.unread ? ' unread' : ''}${item.type === 'school_late' || item.type === 'school_remark' ? ' school-alert' : ''}`} aria-expanded={expanded === thread.key} onClick={() => { void openNotice(thread) }}>
          <span className="notification-dot" aria-hidden="true" /><span className="notification-copy"><strong>{item.type === 'product_update' ? 'Обновления Education' : title(item)}</strong><span>{item.subject ? `${item.subject} · ` : ''}{item.date ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${item.date}T12:00:00+03:00`)) : item.type === 'product_update' ? 'Что изменилось' : 'Учебная работа'}{thread.items.length > 1 ? ` · ${thread.items.length} события` : ''}</span><small>{noticeTime(item.createdAt)}</small></span><ChevronRight size={17} aria-hidden="true" />
        </button>{expanded === thread.key && <div className="notification-detail">{thread.items.map((entry) => <div className="notification-thread-event" key={entry.id}>{thread.items.length > 1 && <><strong>{title(entry)}</strong><small>{noticeTime(entry.createdAt)}</small></>}{detailBody(entry) && <p>{detailBody(entry)}</p>}{!!entry.changes?.length && <ul>{entry.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}{entry.media && <div className="notification-media">{entry.media.before && <NoticeImage label="Было" media={entry.media.before} />}{entry.media.after && <NoticeImage label="Стало" media={entry.media.after} />}</div>}</div>)}{item.type !== 'product_update' && <button type="button" onClick={() => navigateToNotice(item)}>{item.type === 'olympiad_enabled' ? 'Открыть олимпиады' : item.type === 'grade_added' || item.type === 'grade_changed' ? 'Открыть сводку' : item.type === 'school_late' || item.type === 'school_remark' ? 'Открыть день' : 'Открыть задание'} <ChevronRight size={15} /></button>}</div>}</li>
      })}</ul> : <p className="notification-empty">Новых обновлений нет.</p>}
      {historyCount > 0 && <button className="notification-history-toggle" type="button" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>{showHistory ? 'Скрыть историю' : `История · ${historyCount}`}</button>}
    </section>}
  </div>
}
