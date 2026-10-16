import type { ReactNode } from 'react'
import { ArrowRight, BookOpen, ChevronDown } from 'lucide-react'
import type { CachedHomeworkRow } from '@/lib/dayDashboardViewCache'
import StatusIcon from './StatusIcon'
import '../DayDashboard.css'

/** One date, short group headings and a bounded preview; full tasks stay at their existing destination.
 * @see ../../docs/product/dashboard.md#compact-homework */
export default function HomeworkOverview({ date, rows = [], unconfirmed = [], fallback, onOpen, onOpenAll, openAllLabel = 'Все задания' }: {
  date?: string; rows?: CachedHomeworkRow[]; unconfirmed?: { subject: string; text: string }[];
  fallback?: ReactNode; onOpen: (row: CachedHomeworkRow, taskId?: string) => void;
  onOpenAll?: () => void; openAllLabel?: string;
}) {
  const action = rows.filter(row => row.group === 'action')
  const waiting = rows.filter(row => row.group === 'waiting')
  const complete = rows.filter(row => row.group === 'complete')
  const dateText = date && new Intl.DateTimeFormat('ru-RU', { weekday:'long', day:'numeric', month:'long', timeZone:'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`))
  function renderRow(row: CachedHomeworkRow) {
    const { subject, items, done, group } = row
    const next = items.find(item => item.state === 'todo') ?? items.find(item => item.state === 'checking') ?? items.find(item => item.state === 'unclear')
    const quality = items.find(item => item.qualityOpen)
    const actionLabels:Record<string,string> = {'Нужно исправить работу':'Исправить','Нужно дополнить работу':'Дополнить','Нужно выполнить и загрузить работу':'Выполнить и прислать','Нужно выполнить задание МЭШ':'Выполнить','Нужно пройти самопроверку':'Пройти тест'}
    const actionLabel = next?.state === 'todo' && !done && !next.clarification ? actionLabels[next.detail] : undefined
    const status = next?.clarification ? 'Уточнить материал' : group === 'complete' ? quality ? 'Работа сдана' : 'Всё завершено' : next?.state === 'unclear'
      ? next.unresolvedReason === 'missing-evidence' ? 'Не вся работа видна' : 'Итог не установлен'
      : next?.state === 'checking' ? 'Ждём проверки' : done ? `${done} из ${items.length} завершено` : actionLabel ?? 'Нужно сделать'
    const reason = actionLabel || next?.detail === 'Работа получена, ждём результата проверки' ? undefined : next?.detail ?? quality?.detail
    return <button className={`day-dashboard-homework-row ${group}`} key={subject.id} type="button" onClick={() => onOpen(row, next?.id)}>
      <span className="day-dashboard-icon" aria-hidden="true">{subject.icon}</span>
      <span className="day-dashboard-homework-row-body"><strong>{subject.name}</strong>
        <span className="day-dashboard-homework-status"><StatusIcon size={14} status={group === 'complete' ? 'complete' : next?.state === 'checking' ? 'waiting' : next?.state === 'unclear' ? 'unknown' : done ? 'partial' : 'ready'} />{status}</span>
        <span className="day-dashboard-homework-next">{next?.title ?? subject.tasks.map(task => task.title).join(' · ')}</span>
        {reason && <span className="day-dashboard-homework-reason">{reason}</span>}
      </span><ArrowRight size={18} aria-hidden="true" />
    </button>
  }
  return <section className="day-dashboard-card day-dashboard-homework-card" aria-label="Домашнее задание">
    <div className="day-dashboard-heading day-dashboard-homework-heading"><div><BookOpen size={20} /><h2>Домашнее задание</h2></div>
      {date && <time dateTime={date}>{dateText && dateText[0].toUpperCase() + dateText.slice(1)}</time>}
    </div>
    {rows.length ? <div className="day-dashboard-homework-overview">
      {action.length > 0 && <div className="day-dashboard-homework-group"><h3>Сделать <span>· {action.length}</span></h3>{action.map(renderRow)}</div>}
      {waiting.length > 0 && <div className="day-dashboard-homework-group"><h3>Проверка <span>· {waiting.length}</span></h3>{waiting.map(renderRow)}</div>}
      {unconfirmed.length > 0 && <div className="day-dashboard-homework-group"><h3>Уточнить <span>· {unconfirmed.length}</span></h3><div className="day-dashboard-mesh" aria-label="Статус пока неизвестен">{unconfirmed.map(item => <p key={item.subject}><strong>{item.subject}</strong><span>{item.text}</span></p>)}</div></div>}
      {complete.length > 0 && <details className="day-dashboard-homework-complete"><summary><StatusIcon status="complete" size={18} /><span>Сделано · {complete.length}</span><ChevronDown size={17} aria-hidden="true" /></summary><div>{complete.map(renderRow)}</div></details>}
    </div> : fallback}
    {onOpenAll && <button className="day-dashboard-detail-link" type="button" onClick={onOpenAll}>{openAllLabel} <ArrowRight size={17} aria-hidden="true" /></button>}
  </section>
}
