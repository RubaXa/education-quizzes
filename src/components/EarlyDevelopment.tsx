/** @see ../../docs/modules/families/early-development.md */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Heart, MessageCircle, Plus, Sprout } from 'lucide-react'
import { Button } from './ui/button'
import { activities, PROGRAM_VERSION, reactions, readObservations, sources, suggestedActivities, writeObservations, type Observation, type Reaction } from '@/lib/earlyDevelopment'
import './EarlyDevelopment.css'

type Tab = 'Сегодня' | 'Программа' | 'Дневник'
const stages = [
  ['Первые недели', 'Контакт, спокойный голос и знакомство с миром', 'Открыт в прототипе'],
  ['1–6 месяцев', 'Общение, исследование и движение', 'План содержания'],
  ['6–12 месяцев', 'Совместные игры и исследование предметов', 'План содержания'],
  ['1–3 года', 'Речь, игра и самостоятельность', 'План содержания'],
  ['3 года — школа', 'Сюжетные игры, общение и любознательность', 'План содержания'],
]
const dateLabel = (value: string) => new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

export default function EarlyDevelopment() {
  const [tab, setTab] = useState<Tab>('Сегодня')
  const [initial] = useState(() => { try { return { entries: readObservations(localStorage), error: '' } } catch { return { entries: [], error: 'Не удалось прочитать дневник. Сохранённые данные не перезаписаны. Проверьте доступ к хранилищу и перезагрузите страницу.' } } })
  const [entries, setEntries] = useState(initial.entries)
  const [error, setError] = useState(initial.error)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [reaction, setReaction] = useState<Reaction | ''>('')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const suggestion = suggestedActivities(entries)
  const activity = activities.find((item) => item.id === selected)
  function open(id: string) { setSelected(id); setEditing(null); setReaction(''); setNote(''); setSaved(false); setShowForm(false) }
  function persist(next: Observation[]) {
    try { writeObservations(localStorage, next); setEntries(next); setError(''); return true }
    catch { setError('Не удалось сохранить на устройстве. Ваша запись остаётся в форме — попробуйте ещё раз.'); return false }
  }
  function save() {
    if (!reaction || !activity || initial.error) return
    const previous = entries.find((item) => item.id === editing)
    const next: Observation = { id: previous?.id ?? crypto.randomUUID(), activityId: activity.id, programVersion: previous?.programVersion ?? PROGRAM_VERSION,
      observedAt: previous?.observedAt ?? new Date().toISOString(), ...(previous ? { updatedAt: new Date().toISOString() } : {}), reaction, note: note.trim() }
    if (persist([next, ...entries.filter((item) => item.id !== next.id)])) { setSaved(true); setShowForm(false); setEditing(null) }
  }
  return <div className="early-development">
    <p className="early-preview-notice">Предпросмотр · условный профиль, 7 дней. Записи сохраняются только в этом браузере.</p>
    <header className="early-heading"><span className="early-eyebrow">Кабинет родителя · с рождения до школы</span><h1>Раннее развитие</h1><p>Малыш <span>· Первые недели</span></p></header>
    <nav className="early-tabs" aria-label="Раннее развитие">{(['Сегодня', 'Программа', 'Дневник'] as Tab[]).map((item) => <button key={item} aria-current={tab === item ? 'page' : undefined} onClick={() => { setTab(item); setSelected(null); setSaved(false) }}>{item}</button>)}</nav>
    {error && <p role="alert" className="early-error">{error}</p>}
    {activity ? <section className="early-panel" aria-label={activity.title}>
      <button className="early-text-button" onClick={() => setSelected(null)}><ArrowLeft size={17} /> Назад</button>
      <p className="early-eyebrow">{activity.area}</p><h2>{activity.title}</h2><p>{activity.intro}</p>
      <ol className="early-steps">{activity.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <h3>Что можно заметить</h3><p>{activity.notice}</p><div className="early-cues"><h3>Когда остановиться</h3><p>{activity.stop}</p></div>
      <p className="early-source"><a href={sources[activity.source].url} target="_blank" rel="noreferrer">{sources[activity.source].title}</a></p>
      {!showForm && !saved && <Button onClick={() => setShowForm(true)}><Plus size={17} /> Записать наблюдение</Button>}
      {saved && <div role="status"><p>Наблюдение сохранено в этом браузере.</p><Button variant="outline" onClick={() => { setSelected(null); setTab('Дневник') }}>Посмотреть дневник <ArrowRight size={17} /></Button></div>}
      {showForm && <form className="early-form" onSubmit={(event) => { event.preventDefault(); save() }}>
        <fieldset><legend>Что вы заметили?</legend><div className="early-reactions">{reactions.map((value) => <label key={value}><input type="radio" name="reaction" value={value} checked={reaction === value} onChange={() => setReaction(value)} required />{value}</label>)}</div></fieldset>
        <label htmlFor="early-note">Подробности · необязательно</label><textarea id="early-note" value={note} maxLength={1500} placeholder="Например: посмотрела на картинку, потом отвернулась. Мы убрали её." onChange={(event) => setNote(event.target.value)} />
        <p className="early-muted">Один эпизод, без оценки навыка. Время записи будет сохранено автоматически.</p>
        <div className="early-actions"><Button type="submit" disabled={!reaction || !!initial.error}>{editing ? 'Сохранить изменения' : 'Сохранить в дневник'}</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Отмена</Button></div>
      </form>}
    </section> : tab === 'Сегодня' ? <>
      <section className="early-welcome"><Heart aria-hidden="true" size={25} /><div><h2>Сначала — быть рядом</h2><p>Выберите спокойное бодрствование. Если малыш спит, голоден или беспокоится — вернитесь к идеям позже.</p></div></section>
      <section aria-labelledby="early-today"><div className="early-section-heading"><h2 id="early-today">Что можно попробовать</h2><span>Первые недели</span></div><p className="early-muted">{suggestion.reason}</p><div className="early-ideas">{suggestion.items.map((item) => <button className="early-idea" key={item.id} onClick={() => open(item.id)}><span className="early-idea-icon">{item.id === 'voice' ? <MessageCircle /> : item.id === 'face' ? <Heart /> : <BookOpen />}</span><span><small>{item.area}</small><strong>{item.title}</strong><span>{item.materials}</span></span><ArrowRight size={19} aria-hidden="true" /></button>)}</div></section>
      <details className="early-panel early-lesson"><summary><Sprout size={20} /> Родителю: как понять, что пора сделать паузу?</summary><p>Смотрите на состояние малыша. Сонливость и беспокойство — повод отложить игру. При плаче прекратите занятие и помогите ему успокоиться. План можно оставить на другой день.</p><a href={sources.cues.url} target="_blank" rel="noreferrer">Подробнее: NHS о сигналах ребёнка</a></details>
      <p className="early-muted">Записывайте, если вам удобно. Отсутствие записи не означает, что вы что-то упустили.</p>
    </> : tab === 'Программа' ? <section className="early-panel"><h2>Растём через общение и игру</h2><p>Ориентир — возраст и интерес малыша. Сейчас доступны идеи первых недель; следующие разделы ещё предстоит наполнить.</p><ol className="early-program">{stages.map(([title, description, state]) => <li key={title}><strong>{title}</strong><p>{description}</p><small>{state}</small></li>)}</ol><h3>На чём основана программа</h3><p>Принципы отзывчивого ухода ВОЗ/ЮНИСЕФ: замечать сигналы ребёнка и отвечать на них в общении и игре. Это авторский прототип, его эффективность отдельно не исследовалась.</p><a href={sources.ccd.url} target="_blank" rel="noreferrer">Care for Child Development</a><details className="early-cues"><summary>Наблюдение и скрининг развития</summary><p>Заметки помогают вспомнить примеры для разговора с педиатром. Медицинский скрининг проводится подходящим валидированным инструментом. Здесь нет диагностического теста. Если развитие вызывает тревогу, обсудите её с педиатром, не ожидая следующего этапа программы.</p><a href="https://www.cdc.gov/act-early/about/developmental-monitoring-and-screening.html" target="_blank" rel="noreferrer">CDC: в чём различие</a></details><details className="early-cues"><summary>Картинки и семейная библиотека</summary><p>Чёрно-белая раскладушка — один из способов предложить картинку. Можно обойтись простой контрастной фигурой. Покупка набора не является условием программы. Все загруженные семейные книги остаются общими для детей; здесь нет повторного запроса учебников.</p></details></section>
      : <section className="early-panel"><h2>Дневник наблюдений</h2><p className="early-muted">Только ваши записи. Можно исправить описание или удалить его. В прототипе нет синхронизации между устройствами.</p>{entries.length === 0 ? <div className="early-empty"><BookOpen size={30} /><h3>Пока нет наблюдений</h3><p>После игры можно записать реакцию. Дневник необязательно вести каждый день.</p><Button variant="outline" onClick={() => setTab('Сегодня')}>Выбрать идею <ArrowRight size={17} /></Button></div> : <ol className="early-journal">{[...entries].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).map((entry) => <li key={entry.id}><time dateTime={entry.observedAt}>{dateLabel(entry.observedAt)}</time><h3>{activities.find((item) => item.id === entry.activityId)?.title}</h3><p>{entry.reaction}{entry.note ? ` · ${entry.note}` : ''}</p>{entry.updatedAt && <small>Отредактировано {dateLabel(entry.updatedAt)}</small>}<div className="early-actions"><Button variant="ghost" onClick={() => { open(entry.activityId); setEditing(entry.id); setReaction(entry.reaction); setNote(entry.note); setShowForm(true) }}>Изменить</Button><Button variant="ghost" onClick={() => persist(entries.filter((item) => item.id !== entry.id))}>Удалить</Button></div></li>)}</ol>}</section>}
  </div>
}
