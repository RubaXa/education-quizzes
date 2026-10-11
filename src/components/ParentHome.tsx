import { useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronDown, Clock3 } from 'lucide-react'
import type { PersonalChild, PersonalProfile } from '@/lib/personalAccess'
import { useParentChildOverview } from '@/lib/useParentChildOverview'
import type { ParentChildOverview, ParentSubjectOverview } from '@/lib/useParentChildOverview'
import { FamilyLibrary } from './FamilyLibrary'
import { FamilyAccessCards } from './FamilyAccessCards'
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
  return subject.state === 'todo' ? 0 : subject.state === 'unclear' ? 1 : subject.state === 'checking' ? 2 : 3
}

function ChildCardWithProgress({ child }: { child: PersonalChild & { dashboardToken: string } }) {
  const overview = useParentChildOverview(child.dashboardToken)
  return <ChildCard child={child} overview={overview} />
}

/** @see ../../docs/product/design-system.md#cards-and-status
 *  @see ../../docs/architecture/family-data-model.md#parent-home */
function ChildCard({ child, overview }: { child: PersonalChild; overview?: ParentChildOverview }) {
  const [open, setOpen] = useState(false)
  const ready = overview?.state === 'ready'
  const confirmed = ready && overview.day?.complete === true
  const badge = !child.dashboardToken ? 'Календарь не подключён'
    : !overview || overview.state === 'loading' ? 'Загружаем данные'
    : overview.state === 'unknown' ? overview.reason.startsWith('Не удалось') ? 'Данные недоступны' : 'ДЗ уточняется'
      : overview.state === 'none' ? overview.weekendCards ? 'Есть подготовка' : 'Пока нет ДЗ'
        : !confirmed ? 'ДЗ может измениться'
          : overview.todo ? `${overview.todo} осталось`
            : overview.unclear ? 'Решение взрослого'
              : overview.checking ? 'Ждём проверку' : overview.weekendCards ? 'Есть подготовка' : 'Всё готово'
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
      <span className="parent-child-top"><span className="parent-child-name">{child.displayName}</span><span className={`parent-child-badge ${tone}`}>{badge}</span></span>
      <span className="parent-child-date">{day ? `К ${dateLabel(day.date)}` : 'Ближайший учебный день пока неизвестен'}</span>
      {known && <><span className="parent-child-track" role="progressbar" aria-label={`Выполнено ${overview.done} из ${overview.total} опубликованных заданий`} aria-valuemin={0} aria-valuemax={overview.total} aria-valuenow={overview.done}><span className="parent-child-done" style={{ width: `${overview.done / overview.total * 100}%` }} /><span className="parent-child-checking" style={{ width: `${overview.checking / overview.total * 100}%` }} /></span><span className="parent-child-progress">{overview.done} из {overview.total} завершено{overview.checking ? ` · ${overview.checking} ждёт проверки` : ''}{overview.unclear ? ` · ${overview.unclear} требует решения взрослого` : ''}</span></>}
      {!known && <span className="parent-child-progress">{!child.dashboardToken ? 'Сводка появится после подключения календаря.' : overview?.reason || 'Загружаем опубликованные сведения.'}</span>}
      <span className="parent-child-expand">{open ? 'Скрыть подробности' : 'Что именно?'} <ChevronDown size={18} aria-hidden="true" /></span>
    </button>
    <div id={childPanelId(child)} className="parent-child-detail" hidden={!open}>
      {overview?.reason && ready && <p className="parent-child-note">{overview.reason}</p>}
      {overview?.weekendCards ? <p className="parent-child-note">На выходные доступны {overview.weekendCards} {countWord(overview.weekendCards, 'карточка подготовки', 'карточки подготовки', 'карточек подготовки')}. Их результаты и сроки смотрите в календаре.</p> : null}
      {active.map((subject) => <div className="parent-child-subject" key={subject.id}><strong>{subject.name}</strong>{subject.items.filter((item) => item.state !== 'done').map((item) => <p key={item.id}><span aria-hidden="true">{item.state === 'todo' ? '→' : item.state === 'checking' ? '◷' : '?'}</span><span>{item.title} · {item.detail}</span></p>)}</div>)}
      {done.length > 0 && <details className="parent-child-complete"><summary><CheckCircle2 size={17} aria-hidden="true" /> Сделано · {done.length} {countWord(done.length, 'предмет', 'предмета', 'предметов')} <ChevronDown size={16} aria-hidden="true" /></summary><ul>{done.map((subject) => <li key={subject.id}>{subject.name} · {subject.items.length} {countWord(subject.items.length, 'пункт', 'пункта', 'пунктов')}</li>)}</ul></details>}
      {overview?.state === 'none' && <p className="parent-child-note">{overview.reason}</p>}
      {overview?.state === 'unknown' && <p className="parent-child-note">{overview.reason}</p>}
      {overview?.state === 'loading' && <p className="parent-child-note">{overview.reason || 'Загружаем работы и результаты.'}</p>}
      {!child.dashboardToken && <p className="parent-child-note">Календарь этого ребёнка ещё не опубликован для вашего профиля.</p>}
      {day && <small className="parent-child-source">МЭШ проверен: {checkedLabel(day.checkedAt)}.</small>}
      {child.dashboardToken && <a className="parent-child-open" href={`#/days-parent/${child.dashboardToken}`}>Открыть календарь {child.displayName} <ArrowRight size={17} aria-hidden="true" /></a>}
    </div>
  </article>
}

/** @see ../../docs/architecture/family-data-model.md#parent-home
 *  @see ../../docs/product/design-system.md#shell */
export function ParentHome({ profile }: { profile: PersonalProfile }) {
  const children = profile.children.filter((child) => child.role === 'parent')
  const families = [...new Set(children.map((child) => child.familyId))]
  return <div className="parent-home"><div className="parent-home-heading"><p>Кабинет родителя</p><h1>Дети</h1><span>Выберите ребёнка, чтобы увидеть, что сделано и что осталось.</span></div>
    {families.map((familyId) => <FamilyLibrary key={familyId} familyId={familyId} familyChildren={children.filter((child) => child.familyId === familyId)} />)}
    <section className="parent-children" aria-label="Домашние задания детей">{children.length === 0 && <p className="parent-home-empty">В профиле пока нет подключённых детей. Данные и личные ссылки добавляет владелец сервиса.</p>}{children.map((child) => child.dashboardToken
      ? <ChildCardWithProgress key={childKey(child)} child={child as PersonalChild & { dashboardToken: string }} />
      : <ChildCard key={childKey(child)} child={child} />)}</section>
    {families.map((familyId) => <FamilyAccessCards key={familyId} profile={profile} familyChildren={children.filter((child) => child.familyId === familyId)} />)}
    <p className="parent-home-footnote"><Clock3 size={15} aria-hidden="true" /> Данные обновляются при публикации изменений в Firestore. Последнее время проверки МЭШ указано в карточке ребёнка.</p>
  </div>
}
