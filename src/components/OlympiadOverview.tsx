/** @see ../../docs/shared/design/information-hierarchy.md */
import type {PublicOlympiad} from '@/lib/educationStore'
import OlympiadSchedule from './OlympiadSchedule'
import './OlympiadOverview.css'
import {ArrowLeft} from 'lucide-react'
import {Button} from './ui/button'
export function OlympiadBackLink({href}:{href:string}){return <nav className="olympiad-page-navigation" aria-label="Возврат"><Button asChild variant="ghost" className="olympiad-back"><a href={href}><ArrowLeft size={16} aria-hidden="true"/>На главную</a></Button></nav>}

type SectionLink={id:string;label:string;count?:number}
/** Only a declared subject/season suffix moves to metadata; other titles stay intact. */
export function olympiadHeading(title:string,subject?:string){
 const match=/^(.*) — ([^—]+?) (\d{4}[–-]\d{4})$/.exec(title)
 return match&&subject&&match[2].toLocaleLowerCase('ru')===subject.toLocaleLowerCase('ru')
  ?{title:match[1],meta:`${subject} · ${match[3]}`}
  :{title,meta:subject&&!title.toLocaleLowerCase('ru').includes(subject.toLocaleLowerCase('ru'))?subject:undefined}
}
export default function OlympiadOverview({olympiad,sections=[]}:{olympiad:Pick<PublicOlympiad,'title'|'subject'|'schedule'|'calendar'>;sections?:SectionLink[]}){
 const heading=olympiadHeading(olympiad.title,olympiad.subject)
 function go(id:string){const target=document.getElementById(id);target?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});target?.focus({preventScroll:true})}
 return <div className="olympiad-overview">
  <header className="olympiad-overview-heading"><h1>{heading.title}</h1>{heading.meta&&<p>{heading.meta}</p>}</header>
  {!olympiad.calendar&&olympiad.schedule&&<p className="olympiad-overview-fallback">{olympiad.schedule}</p>}
  {sections.length>0&&<nav className="olympiad-section-nav" aria-label="Разделы олимпиады">{sections.map(section=><button type="button" key={section.id} aria-controls={section.id} onClick={()=>go(section.id)}>{section.label}{section.count!==undefined&&<span>{section.count}</span>}</button>)}</nav>}
  <OlympiadSchedule calendar={olympiad.calendar}/>
 </div>
}
