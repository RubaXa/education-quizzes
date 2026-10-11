import { useEffect, useState } from 'react'
import { Bell, ChevronRight, X } from 'lucide-react'
import { markNotificationRead, watchEducationUser, watchInbox } from '@/lib/educationStore'
import type { InboxNotification } from '@/lib/educationSchema'
import { loadPersonalProfile, restorePersonalSession } from '@/lib/personalAccess'
import type { PersonalChild } from '@/lib/personalAccess'
import './NotificationBell.css'

type Notice = InboxNotification & { id: string }

function title(notice: Notice) {
  if (notice.type === 'homework_published') return 'Появилось домашнее задание'
  if (notice.type === 'homework_changed') return 'Домашнее задание изменилось'
  if (notice.type === 'homework_removed') return 'Домашнее задание снято'
  if (notice.type === 'grade_added') return 'Появилась новая оценка'
  return 'Работа проверена'
}
function noticeTime(value: unknown) {
  const millis = typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function' ? value.toMillis() : Date.parse(String(value ?? ''))
  return Number.isFinite(millis) ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(millis)) : ''
}
function todayMoscow() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date())
}

/** @see ../../docs/architecture/activity-and-inbox.md#in-app-center */
export default function NotificationBell({ routeKey }: { routeKey: string }) {
  const [personId, setPersonId] = useState<string | null>(null)
  const [children, setChildren] = useState<PersonalChild[]>([])
  const [items, setItems] = useState<Notice[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const session = await restorePersonalSession()
        if (!active) return
        setPersonId(session?.personId ?? null)
        if (!session) { setChildren([]); return }
        const profile = await loadPersonalProfile(session)
        if (active) setChildren(profile.children)
      } catch { if (active) { setPersonId(null); setChildren([]) } }
    }
    const stop = watchEducationUser(() => { void refresh() })
    void refresh()
    return () => { active = false; stop() }
  }, [routeKey])

  useEffect(() => {
    if (!personId) { setItems([]); return }
    try { return watchInbox(setItems, (cause) => setError(cause.message)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось получить обновления.') }
  }, [personId])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!personId || routeKey.startsWith('#/enter/')) return null
  const unread = items.filter((item) => !item.readAt).length

  async function openNotice(item: Notice) {
    try { await markNotificationRead(item.id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отметить обновление прочитанным.') }
    const child = children.find((entry) => entry.childId === item.childId && entry.familyId === item.familyId && entry.dashboardToken)
    if (!child) { setError('Переход к учебному дню ещё не подключён для этого профиля.'); return }
    if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      sessionStorage.setItem('education-dashboard-selected-date', item.date)
      sessionStorage.setItem('education-dashboard-selection-day', todayMoscow())
      if (item.subject) sessionStorage.setItem('education-dashboard-focus-subject', item.subject)
    }
    setOpen(false)
    const target = `#/${child.role === 'parent' ? 'days-parent' : 'days'}/${child.dashboardToken}`
    if (window.location.hash === target) window.dispatchEvent(new Event('education-notification-navigation'))
    else window.location.hash = target
  }

  return <div className="notification-center">
    <button className="notification-bell" type="button" aria-label={`Обновления${unread ? `, непрочитанных: ${unread}` : ''}`} aria-expanded={open} aria-controls="education-notification-list" onClick={() => setOpen((value) => !value)}>
      <Bell size={20} aria-hidden="true" />{unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section id="education-notification-list" className="notification-panel" aria-label="Обновления Education">
      <header><h2>Обновления</h2><button type="button" aria-label="Закрыть обновления" onClick={() => setOpen(false)}><X size={19} /></button></header>
      {error && <p className="notification-error">{error}</p>}
      {items.length ? <ul>{items.map((item) => <li key={item.id}><button type="button" className={item.readAt ? 'notification-item' : 'notification-item unread'} onClick={() => { void openNotice(item) }}>
        <span className="notification-dot" aria-hidden="true" /><span className="notification-copy"><strong>{title(item)}</strong><span>{item.subject ? `${item.subject} · ` : ''}{item.date ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${item.date}T12:00:00+03:00`)) : 'Открыть день'}</span><small>{noticeTime(item.createdAt)}</small></span><ChevronRight size={17} aria-hidden="true" />
      </button></li>)}</ul> : <p className="notification-empty">Пока обновлений нет.</p>}
    </section>}
  </div>
}
