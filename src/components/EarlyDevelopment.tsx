/** @see ../../docs/modules/families/early-development.md */
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Heart, MessageCircle, Plus, Sprout } from 'lucide-react'
import { Button } from './ui/button'
import { reactions, readObservations, sources, suggestedActivities, writeObservations, earlyStage, program, type Observation, type Reaction } from '@/lib/earlyDevelopment'
import type { PersonalChild } from '@/lib/personalAccess'
import type { EarlyPlan } from '@/lib/earlyDevelopmentStore'
import './EarlyDevelopment.css'

type Tab = 'Сегодня' | 'Программа' | 'Дневник'
const dateLabel = (value: string) => new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })

type LiveContext = { plan: EarlyPlan; child: PersonalChild; entries: Observation[]; save: (entry: Observation, previous?: Observation) => Promise<void>; loadMore?: () => void }
export default function EarlyDevelopment({ live }: { live?: LiveContext }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const refresh = () => setNow(new Date()); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) } }, [])
  const curriculum = live?.plan.curriculum ?? program
  const age = live ? earlyStage(live.plan.birthDate, curriculum, now) : { stage: curriculum.stages[0], days: 7, months: 0 }
  const currentStage = age?.stage
  const choices = currentStage?.activities ?? []
  const allActivities = [...curriculum.stages.flatMap((stage) => stage.activities), { id: 'free-note', title: 'Свободная заметка', area: 'Наблюдение', materials: '', intro: 'Запишите то, что хотите запомнить.', steps: [], notice: '', stop: '', source: 'ccd' as const }]
  const [busy, setBusy] = useState(false)
  const [editingBase, setEditingBase] = useState<Observation | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('Сегодня')
  const [initial] = useState(() => { if (live) return { entries: [] as Observation[], error: '' }; try { return { entries: readObservations(localStorage), error: '' } } catch { return { entries: [], error: 'Не удалось прочитать дневник. Сохранённые данные не перезаписаны. Проверьте доступ к хранилищу и перезагрузите страницу.' } } })
  const [localEntries, setEntries] = useState(initial.entries)
  const entries = live?.entries ?? localEntries
  const [error, setError] = useState(initial.error)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [reaction, setReaction] = useState<Reaction | ''>('')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const suggestion = suggestedActivities(entries.filter((item) => !item.deleted), choices)
  const activity = allActivities.find((item) => item.id === selected)
  function scrollToStart() { window.scrollTo(0, 0) }
  function open(id: string) { scrollToStart(); setSelected(id); setEditing(null); setEditingBase(undefined); setReaction(''); setNote(''); setSaved(false); setShowForm(false) }
  async function persist(next: Observation[], changed?: Observation, previous?: Observation) {
    if (busy) return false
    setBusy(true)
    try { if (live && changed) await live.save(changed, previous); else if (!live) { writeObservations(localStorage, next); setEntries(next) }; setError(''); return true }
    catch (cause) { setError(live ? (cause instanceof Error && !('code' in cause) ? cause.message : 'Не удалось сохранить. Проверьте подключение и повторите; текст остаётся в форме.') : 'Не удалось сохранить на устройстве. Ваша запись остаётся в форме — попробуйте ещё раз.'); return false }
    finally { setBusy(false) }
  }
  async function save() {
    if (!reaction || !activity || initial.error || busy || activity.id === 'free-note' && !note.trim()) return
    const previous = editingBase
    const next: Observation = { ...(previous ?? {}), id: previous?.id ?? crypto.randomUUID(), activityId: activity.id, activityTitle: previous?.activityTitle ?? activity.title, programVersion: previous?.programVersion ?? curriculum.version,
      observedAt: previous?.observedAt ?? new Date().toISOString(), ...(previous ? { updatedAt: new Date().toISOString() } : {}), reaction, note: note.trim() }
    if (await persist([next, ...entries.filter((item) => item.id !== next.id)], next, previous)) { setSaved(true); setShowForm(false); setEditing(null); setEditingBase(undefined) }
  }
  const visibleEntries = entries.filter((entry) => !entry.deleted)
  const deletedEntries = entries.filter((entry) => entry.deleted)
  if (!age || !currentStage) return <p role="alert">Не удалось определить этап программы. Проверьте дату рождения в профиле.</p>
  return <div className="early-development">
    {!live && <p className="early-preview-notice">Предпросмотр · условный профиль, 7 дней. Записи сохраняются только в этом браузере.</p>}
    <header className="early-heading"><span className="early-eyebrow">Кабинет родителя · с рождения до школы</span><h1>Раннее развитие</h1><p>{live?.child.displayName ?? 'Малыш'} <span>· {age.months ? `${age.months} мес.` : `${age.days} дн.`} · {currentStage.title}</span></p></header>
    <nav className="early-tabs" aria-label="Раннее развитие">{(['Сегодня', 'Программа', 'Дневник'] as Tab[]).map((item) => <button key={item} disabled={busy} aria-current={tab === item ? 'page' : undefined} onClick={() => { scrollToStart(); setTab(item); setSelected(null); setSaved(false) }}>{item}</button>)}</nav>
    {error && <p role="alert" className="early-error">{error}</p>}
    {activity ? <section className="early-panel" aria-label={activity.title}>
      <button className="early-text-button" onClick={() => { scrollToStart(); setSelected(null) }}><ArrowLeft size={17} /> Назад</button>
      <p className="early-eyebrow">{activity.area}</p><h2>{activity.title}</h2><p>{activity.intro}</p>
      {activity.id !== 'free-note' && <><ol className="early-steps">{activity.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <h3>Что можно заметить</h3><p>{activity.notice}</p><div className="early-cues"><h3>Когда остановиться</h3><p>{activity.stop}</p></div>
      <p className="early-source"><a href={sources[activity.source].url} target="_blank" rel="noreferrer">{sources[activity.source].title}</a></p></>}
      {!showForm && !saved && <Button onClick={() => setShowForm(true)}><Plus size={17} /> Записать наблюдение</Button>}
      {saved && <div role="status"><p>{live ? 'Наблюдение сохранено. Оно доступно родителям на других устройствах.' : 'Наблюдение сохранено в этом браузере.'}</p><Button variant="outline" onClick={() => { scrollToStart(); setSelected(null); setTab('Дневник') }}>Посмотреть дневник <ArrowRight size={17} /></Button></div>}
      {showForm && <form className="early-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        {activity.id !== 'free-note' && <fieldset><legend>Что вы заметили?</legend><div className="early-reactions">{reactions.map((value) => <label key={value}><input type="radio" name="reaction" disabled={busy} value={value} checked={reaction === value} onChange={() => setReaction(value)} required />{value}</label>)}</div></fieldset>}
        <label htmlFor="early-note">{activity.id === 'free-note' ? 'Наблюдение' : 'Подробности · необязательно'}</label><textarea id="early-note" disabled={busy} required={activity.id === 'free-note'} value={note} maxLength={1500} placeholder="Например: посмотрела на картинку, потом отвернулась. Мы убрали её." onChange={(event) => setNote(event.target.value)} />
        <p className="early-muted">Один эпизод, без оценки навыка. Время записи будет сохранено автоматически.</p>
        <div className="early-actions"><Button type="submit" disabled={busy || !reaction || !!initial.error || activity.id === 'free-note' && !note.trim()}>{editing ? 'Сохранить изменения' : 'Сохранить в дневник'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setShowForm(false)}>Отмена</Button></div>
      </form>}
    </section> : tab === 'Сегодня' ? <>
      <section className="early-welcome"><Heart aria-hidden="true" size={25} /><div><h2>Сначала — быть рядом</h2><p>Выберите спокойное бодрствование. Если малыш спит, голоден или беспокоится — вернитесь к идеям позже.</p></div></section>
      <section aria-labelledby="early-today"><div className="early-section-heading"><h2 id="early-today">Что можно попробовать</h2><span>{currentStage.title}</span></div><p className="early-muted">{suggestion.reason}</p><div className="early-ideas">{suggestion.items.map((item) => <button className="early-idea" key={item.id} onClick={() => open(item.id)}><span className="early-idea-icon">{item.id === 'voice' ? <MessageCircle /> : item.id === 'face' ? <Heart /> : <BookOpen />}</span><span><small>{item.area}</small><strong>{item.title}</strong><span>{item.materials}</span></span><ArrowRight size={19} aria-hidden="true" /></button>)}</div></section>
      <details className="early-panel early-lesson"><summary><Sprout size={20} /> Родителю: как понять, что пора сделать паузу?</summary><p>Смотрите на состояние малыша. Сонливость и беспокойство — повод отложить игру. При плаче прекратите занятие и помогите ему успокоиться. План можно оставить на другой день.</p><a href={sources.cues.url} target="_blank" rel="noreferrer">Подробнее: NHS о сигналах ребёнка</a></details>
      <p className="early-muted">Записывайте, если вам удобно. Отсутствие записи не означает, что вы что-то упустили.</p>
    </> : tab === 'Программа' ? <section className="early-panel"><h2>Растём через общение и игру</h2><p>Ориентир — возраст и интерес ребёнка. Эти идеи можно повторять и менять; обязательного объёма занятий нет.</p><ol className="early-program">{curriculum.stages.map((stage) => <li key={stage.id}><strong>{stage.title}{stage.id === currentStage.id ? ' · сейчас' : ''}</strong><p>{stage.goal}</p><details><summary>Идеи этапа</summary><ul>{stage.activities.map((item) => <li key={item.id}>{item.title}</li>)}</ul></details></li>)}</ol><h3>На чём основана программа</h3><p>Принципы отзывчивого ухода ВОЗ/ЮНИСЕФ: замечать сигналы ребёнка и отвечать на них в общении и игре. Это авторская программа на основе этих принципов; её эффективность отдельно не исследовалась.</p><a href={sources.ccd.url} target="_blank" rel="noreferrer">Care for Child Development</a><details className="early-cues"><summary>Наблюдение и скрининг развития</summary><p>Заметки помогают вспомнить примеры для разговора с педиатром. Медицинский скрининг проводится подходящим валидированным инструментом. Здесь нет диагностического теста. Если развитие вызывает тревогу, обсудите её с педиатром, не ожидая следующего этапа программы.</p><a href="https://www.cdc.gov/act-early/about/developmental-monitoring-and-screening.html" target="_blank" rel="noreferrer">CDC: в чём различие</a></details><details className="early-cues"><summary>Картинки и семейная библиотека</summary><p>Чёрно-белая раскладушка — один из способов предложить картинку. Можно обойтись простой контрастной фигурой. Покупка набора не является условием программы. Все загруженные семейные книги остаются общими для детей; здесь нет повторного запроса учебников.</p></details></section>
      : <section className="early-panel"><h2>Дневник наблюдений</h2><p className="early-muted">{live ? 'Записи общие для родителей с доступом к ребёнку. Изменения сохраняются в истории; удалённую запись можно восстановить.' : 'Только ваши записи. Можно исправить описание или удалить его. В прототипе нет синхронизации между устройствами.'}</p>{visibleEntries.length === 0 ? <div className="early-empty"><BookOpen size={30} /><h3>Пока нет наблюдений</h3><p>После игры можно записать реакцию. Дневник необязательно вести каждый день.</p><Button variant="outline" onClick={() => { scrollToStart(); setTab('Сегодня') }}>Выбрать идею <ArrowRight size={17} /></Button></div> : <ol className="early-journal">{[...visibleEntries].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).map((entry) => <li key={entry.id}><time dateTime={entry.observedAt}>{dateLabel(entry.observedAt)}</time><h3>{entry.activityTitle ?? allActivities.find((item) => item.id === entry.activityId)?.title}</h3><p>{entry.reaction}{entry.note ? ` · ${entry.note}` : ''}</p>{entry.updatedAt && <small>Отредактировано {dateLabel(entry.updatedAt)}</small>}<div className="early-actions"><Button variant="ghost" onClick={() => { open(entry.activityId); setEditing(entry.id); setEditingBase(entry); setReaction(entry.reaction); setNote(entry.note); setShowForm(true) }}>Изменить</Button><Button variant="ghost" disabled={busy} onClick={() => void persist(entries.filter((item) => item.id !== entry.id), { ...entry, deleted: true }, entry)}>Удалить</Button></div></li>)}</ol>}
        <Button variant="outline" disabled={busy} onClick={() => { open('free-note'); setReaction('Другое'); setShowForm(true) }}><Plus size={17} /> Свободная заметка</Button>
        {live?.loadMore && <Button variant="outline" disabled={busy} onClick={live.loadMore}>Загрузить более ранние записи</Button>}
        {live && deletedEntries.length > 0 && <details className="early-cues"><summary>Удалённые записи · {deletedEntries.length}</summary>{deletedEntries.map((entry) => <div key={entry.id}><p>{entry.activityTitle} · {dateLabel(entry.observedAt)}</p><Button variant="outline" disabled={busy} onClick={() => void persist(entries, { ...entry, deleted: false }, entry)}>Восстановить</Button></div>)}</details>}
      </section>}
  </div>
}
