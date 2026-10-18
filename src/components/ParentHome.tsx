import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, Clock3, AlertCircle, RefreshCw } from 'lucide-react'
import { restorePersonalContext } from '@/lib/personalAccess'
import type { PersonalChild, PersonalProfile } from '@/lib/personalAccess'
import type { InboxNotification } from '@/lib/educationSchema'
import { markNotificationRead, watchInbox } from '@/lib/educationStore'
import { reportUiError } from '@/lib/uiErrors'
import { useParentChildOverview } from '@/lib/useParentChildOverview'
import type { ParentChildOverview, ParentSubjectOverview } from '@/lib/useParentChildOverview'
import { FamilyLibrary } from './FamilyLibrary'
import { FamilyAccessCards } from './FamilyAccessCards'
import { useDelayedRefresh } from '@/lib/useDelayedRefresh'
import { readCachedInbox } from '@/lib/inboxCache'
import StatusIcon from './StatusIcon'
import './ParentHome.css'

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`))
}
function checkedLabel(value: string | null) {
  if (!value) return 'ещё не проверяли'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(timestamp)) : 'время неизвестно'
}
function childKey(child: PersonalChild) { return `${child.familyId}/${child.childId}` }
function childPanelId(child: PersonalChild) { return `parent-child-${encodeURIComponent(child.familyId)}-${encodeURIComponent(child.childId)}` }
function countWord(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100
  if (lastTwo >= 11 && lastTwo <= 14) return many
  const last = count % 10
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many
}
function subjectPriority(subject: ParentSubjectOverview) {
  return subject.state === 'todo' ? 0 : subject.state === 'unknown' ? 1 : subject.state === 'unclear' ? 2 : subject.state === 'checking' ? 3 : 4
}

function ChildCardWithProgress({ child, personId }: { child: PersonalChild & { dashboardToken: string }; personId: string }) {
  const overview = useParentChildOverview(child.dashboardToken, personId)
  return <ChildCard child={child} overview={overview} />
}

/** @see ../../docs/shared/design/statuses.md#components
 *  @see ../../docs/modules/synchronization/global-sync.md#status
 *  @see ../../docs/modules/families/README.md#parent-home */
function ChildCard({ child, overview }: { child: PersonalChild; overview?: ParentChildOverview }) {
  const [open, setOpen] = useState(false)
  const showRefresh = useDelayedRefresh(Boolean(overview?.fromCache && !overview?.error))
  const ready = overview?.state === 'ready'
  const confirmed = ready && overview.day?.complete === true
  const noHomework = overview?.state === 'none' && !overview.weekendCards
  const badge = !child.dashboardToken ? 'Календарь не подключён'
    : !overview || overview.state === 'loading' ? 'Загружаем данные'
    : overview.state === 'unknown' ? overview.reason.startsWith('Не удалось') ? 'Данные недоступны' : 'ДЗ уточняется'
      : overview.state === 'none' ? overview.weekendCards ? 'Есть подготовка' : '⸻'
        : !confirmed ? 'ДЗ может измениться'
          : overview.todo ? `${overview.todo} осталось`
            : overview.unclear ? 'Решение взрослого'
              : overview.checking ? 'Ждём проверку' : overview.weekendCards ? 'Есть подготовка' : 'Всё готово'
  const reason = overview?.state === 'none' ? 'На последней сверке МЭШ домашнее задание к этому дню не задано.' : overview?.reason
  const tone = !overview || overview.state === 'loading' || overview.state === 'unknown' || !confirmed && overview.state !== 'none' ? 'unknown'
    : overview.state === 'none' ? overview.weekendCards ? 'waiting' : 'unknown'
      : overview.todo === 0 && overview.unclear === 0 && overview.checking === 0 && !overview.weekendCards ? 'complete'
      : overview.todo ? 'action' : 'waiting'
  const known = ready && overview.total > 0
  const sorted = [...(overview?.subjects ?? [])].sort((a, b) => subjectPriority(a) - subjectPriority(b))
  const active = sorted.filter((subject) => subject.state !== 'done')
  const done = sorted.filter((subject) => subject.state === 'done')
  const day = overview?.day
  return <article className="parent-child-card">
    <button type="button" className="parent-child-toggle" aria-expanded={open} aria-controls={childPanelId(child)} onClick={() => setOpen((value) => !value)}>
      <span className="parent-child-top"><span className="parent-child-name">{child.displayName}</span><span className={`parent-child-badge ${tone}`} aria-label={noHomework ? 'ДЗ не задано на последней сверке МЭШ' : undefined}>{!noHomework && <StatusIcon size={15} status={tone === 'complete' ? 'complete' : tone === 'action' ? 'needs-fix' : tone === 'waiting' ? 'waiting' : 'unknown'} />}{badge}{showRefresh && <RefreshCw className="parent-child-refresh" size={13} aria-label="Обновление данных" />}</span></span>
      <span className="parent-child-date">{day ? `К ${dateLabel(day.date)}` : 'Ближайший учебный день пока неизвестен'}</span>
      {known && <><span className="parent-child-track" role="progressbar" aria-label={`Выполнено ${overview.done} из ${overview.total} опубликованных заданий`} aria-valuemin={0} aria-valuemax={overview.total} aria-valuenow={overview.done}><span className="parent-child-done" style={{ width: `${overview.done / overview.total * 100}%` }} /><span className="parent-child-checking" style={{ width: `${overview.checking / overview.total * 100}%` }} /></span><span className="parent-child-progress">{overview.done} из {overview.total} завершено{overview.checking ? ` · ${overview.checking} ждёт проверки` : ''}{overview.unclear ? ` · ${overview.unclear} требует решения взрослого` : ''}</span></>}
      {!known && !noHomework && <span className="parent-child-progress">{!child.dashboardToken ? 'Сводка появится после подключения календаря.' : reason || 'Загружаем опубликованные сведения.'}</span>}
      <span className="parent-child-expand">{open ? 'Скрыть подробности' : 'Что именно?'} <ChevronDown size={18} aria-hidden="true" /></span>
    </button>
    <div id={childPanelId(child)} className="parent-child-detail" hidden={!open}>
      {reason && (ready || noHomework) && <p className="parent-child-note">{reason}</p>}
      {overview?.weekendCards ? <p className="parent-child-note">На выходные доступны {overview.weekendCards} {countWord(overview.weekendCards, 'карточка подготовки', 'карточки подготовки', 'карточек подготовки')}. Их результаты и сроки смотрите в календаре.</p> : null}
      {active.map((subject) => <div className="parent-child-subject" key={subject.id}><strong>{subject.name}</strong>{subject.state === 'unknown' ? <small>Статус сверяется</small> : <small>{subject.items.filter((item) => item.state === 'done').length} из {subject.items.length} выполнено</small>}{subject.rawHomework && <p><span aria-hidden="true"><StatusIcon status="unknown" size={15} /></span><span>{subject.rawHomework}</span></p>}{subject.items.filter((item) => item.state !== 'done').map((item) => <p key={item.id}><span aria-hidden="true"><StatusIcon size={15} status={item.state === 'todo' ? 'ready' : item.state === 'checking' ? 'waiting' : 'unknown'} /></span><span>{item.title} · {item.detail}</span></p>)}</div>)}
      {done.length > 0 && <details className="parent-child-complete"><summary><StatusIcon status="complete" size={17} /> Сделано · {done.length} {countWord(done.length, 'предмет', 'предмета', 'предметов')} <ChevronDown size={16} aria-hidden="true" /></summary><ul>{done.map((subject) => <li key={subject.id}>{subject.name} · {subject.items.length} {countWord(subject.items.length, 'пункт', 'пункта', 'пунктов')}</li>)}</ul></details>}
      {overview?.state === 'none' && <p className="parent-child-note">{reason}</p>}
      {overview?.state === 'unknown' && <p className="parent-child-note">{overview.reason}</p>}
      {overview?.state === 'loading' && <p className="parent-child-note">{overview.reason || 'Загружаем работы и результаты.'}</p>}
      {!child.dashboardToken && <p className="parent-child-note">Календарь этого ребёнка ещё не опубликован для вашего профиля.</p>}
      {day && <small className="parent-child-source">{overview?.fromCache ? 'Последнее сохранённое состояние. ' : ''}МЭШ проверен: {checkedLabel(day.checkedAt)}.</small>}
      {child.dashboardToken && <a className="parent-child-open" href={`#/days/${child.dashboardTokens?.student ?? child.dashboardToken}`} onClick={() => { const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date()); sessionStorage.setItem('education-dashboard-selected-date', today); sessionStorage.setItem('education-dashboard-selection-day', today) }}>Открыть календарь {child.displayName} <ArrowRight size={17} aria-hidden="true" /></a>}
    </div>
  </article>
}

/** @see ../../docs/modules/families/README.md#parent-home
 *  @see ../../docs/shared/design/README.md#shell
 *  @see ../../docs/plans/local-first-release-plan-2026-10-12.md */
export function ParentHome({ profile }: { profile: PersonalProfile }) {
  // Keep child lists stable while inbox and progress snapshots rerender this page.
  // useFamilyLibrary subscribes to four streams per child.
  const children = useMemo(() => profile.children.filter((child) => child.role === 'parent'), [profile.children])
  const childrenByFamily = useMemo(() => {
    const result = new Map<string, PersonalChild[]>()
    for (const child of children) result.set(child.familyId, [...(result.get(child.familyId) ?? []), child])
    return result
  }, [children])
  const families = [...childrenByFamily.keys()]
  const [notices, setNotices] = useState<Array<InboxNotification & { id: string }>>(() => readCachedInbox(profile.personId))
  // An old cached read state must not briefly resurrect a school alert while
  // the server confirms that the parent has already read it.
  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    void restorePersonalContext().then((context) => {
      if (!active || context?.session.personId !== profile.personId) return
      stop = watchInbox(setNotices, (error) => { reportUiError(error, 'Школьные сообщения') }, { serverConfirmedOnly: true })
    }).catch((error) => { if (active) reportUiError(error, 'Школьные сообщения') })
    return () => { active = false; stop?.() }
  }, [profile.personId])
  const alerts = notices.filter((notice) => (notice.type === 'school_late' || notice.type === 'school_remark') && !notice.readAt
    && children.some((child) => child.familyId === notice.familyId && child.childId === notice.childId)).slice(0, 3)
  return <div className="parent-home"><div className="parent-home-heading"><p>Кабинет родителя</p><h1>Дети</h1><span>Выберите ребёнка, чтобы увидеть, что сделано и что осталось.</span></div>
    {alerts.length > 0 && <section className="parent-school-alerts" aria-label="Сообщения из МЭШ"><h2><AlertCircle size={20} aria-hidden="true" /> Важно из МЭШ</h2>{alerts.map((notice) => {
      const child = children.find((entry) => entry.familyId === notice.familyId && entry.childId === notice.childId)
      return <article key={notice.id}><strong>{child?.displayName ?? 'Ребёнок'} · {notice.title ?? 'Школьное сообщение'}</strong><span>{notice.subject}{notice.date ? ` · ${dateLabel(notice.date)}` : ''}</span><p>{notice.body}</p>{child?.dashboardToken && <a href={`#/days/${child.dashboardTokens?.student ?? child.dashboardToken}`} onClick={() => { void markNotificationRead(notice.id).catch((error: unknown) => { reportUiError(error, 'Школьные сообщения') }); if (notice.date) { sessionStorage.setItem('education-dashboard-selected-date', notice.date); sessionStorage.setItem('education-dashboard-selection-day', new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date())) } }}>Открыть день <ArrowRight size={15} aria-hidden="true" /></a>}</article>
    })}</section>}
    {families.map((familyId) => <FamilyLibrary key={familyId} familyId={familyId} familyChildren={childrenByFamily.get(familyId)!} />)}
    <section className="parent-children" aria-label="Домашние задания детей">{children.length === 0 && <p className="parent-home-empty">В профиле пока нет подключённых детей. Данные и личные ссылки добавляет владелец сервиса.</p>}{children.map((child) => child.dashboardToken
      ? <ChildCardWithProgress key={`${profile.personId}:${childKey(child)}`} child={child as PersonalChild & { dashboardToken: string }} personId={profile.personId} />
      : <ChildCard key={childKey(child)} child={child} />)}</section>
    {families.map((familyId) => <FamilyAccessCards key={familyId} profile={profile} familyChildren={childrenByFamily.get(familyId)!} />)}
    <p className="parent-home-footnote"><Clock3 size={15} aria-hidden="true" /> Данные обновляются при публикации изменений в Firestore. Последнее время проверки МЭШ указано в карточке ребёнка.</p>
  </div>
}
