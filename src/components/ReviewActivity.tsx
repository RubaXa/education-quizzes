/** @see ../../docs/shared/design/student-review-step.md */
import {createElement,useState} from 'react'
import type {ReviewActivityData} from '../../packages/education-presentation/review-activity.mjs'
import {projectReviewActivity} from '../../packages/education-presentation/review-activity.mjs'
import './ReviewActivity.css'

function Diagram({diagram,selected,continuation=false}:{diagram:NonNullable<ReviewActivityData['diagram']>;selected:readonly string[];continuation?:boolean}){
 if(diagram.kind==='chain')return <ol className="edu-step-chain" aria-label={diagram.label}>{diagram.nodes.map((n,i)=><li key={i}><span>{n}</span>{(i<diagram.nodes.length-1||continuation)&&<svg viewBox="0 0 24 12" aria-hidden="true"><path d="M0 6h21m-5-5 5 5-5 5"/></svg>}</li>)}</ol>
 if(diagram.kind==='lines')return <svg className="edu-step-diagram" viewBox="0 0 120 110" role="img" aria-label={diagram.label}>{diagram.segments.map(s=><g key={s.id} className={selected.includes(s.id)?'is-selected':''}><line x1={s.from.x+10} y1={s.from.y+5} x2={s.to.x+10} y2={s.to.y+5}/>{s.label&&<text x={(s.from.x+s.to.x)/2+10} y={(s.from.y+s.to.y)/2} textAnchor="middle">{s.label}</text>}</g>)}</svg>
 const cell=24,offset=22
 return <svg className="edu-step-grid" viewBox={`0 0 ${diagram.columns*cell+offset} ${diagram.rows*cell+offset}`} role="img" aria-label={diagram.label}>
  {Array.from({length:diagram.columns},(_,c)=><text key={`c${c}`} x={offset+c*cell+12} y={13} textAnchor="middle">{String.fromCharCode(65+c)}</text>)}
  {Array.from({length:diagram.rows},(_,r)=><text key={`r${r}`} x={10} y={offset+r*cell+15} textAnchor="middle">{r+1}</text>)}
  {Array.from({length:diagram.rows*diagram.columns},(_,i)=>{const row=Math.floor(i/diagram.columns),column=i%diagram.columns,c=diagram.cells.find(c=>c.row===row&&c.column===column),x=offset+column*cell,y=offset+row*cell;return <g key={i} className={c?.tokenId&&selected.includes(c.tokenId)?'is-selected':''}><rect x={x+1} y={y+1} width={22} height={22}/>{c?.mark==='hit'?<circle cx={x+12} cy={y+12} r={5}/>:c?.mark==='miss'?<><circle className="edu-step-miss" cx={x+12} cy={y+12} r={7}/><path d={`M${x+7} ${y+7}l10 10m0-10-10 10`}/></>:null}</g>})}
 </svg>
}
/** Local representation of the learner's own choices, never a grader. */
function Activity({activity:a}:{activity:ReviewActivityData}){
 const [selected,setSelected]=useState<string[]>([]),[groups,setGroups]=useState<Record<string,string>>({}),[written,setWritten]=useState<Record<string,string>>({})
 const tokens=new Map(a.tokens.map(t=>[t.id,t.text])),current=selected.map(id=>tokens.get(id))
 const changed=selected.length>0||Object.values(groups).some(Boolean)||Object.values(written).some(Boolean)
 function select(id:string){setSelected(s=>a.kind==='build'?(s.length>=(a.maxItems??20)?s:[...s,id]):s.includes(id)?s.filter(v=>v!==id):[...s,id])}
 return <section className="edu-step" aria-label={a.label}>
  <h4>{a.label}</h4><p className="edu-step-instruction">{a.instruction}</p>
  {a.diagram&&<Diagram diagram={a.diagram} selected={selected} continuation={a.kind==='write'}/>}
  {a.kind==='sort'?<div className="edu-step-sort">{a.tokens.map(t=><label key={t.id}><span>{t.text}</span><select aria-label={`Куда поместить: ${t.text}`} value={groups[t.id]??''} onChange={e=>setGroups(g=>({...g,[t.id]:e.target.value}))}><option value="">Выбери группу</option>{a.groups!.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></label>)}</div>
   :a.kind==='write'?<div className="edu-step-write">{a.tokens.map(t=><label key={t.id}><span>{t.text}</span><input value={written[t.id]??''} placeholder="…" maxLength={160} onChange={e=>setWritten(w=>({...w,[t.id]:e.target.value}))}/></label>)}</div>
    :<div className="edu-step-tokens" role="group" aria-label={a.kind==='build'?'Карточки для записи':'Выделить на модели'}>{a.tokens.map(t=><button type="button" key={t.id} aria-label={t.text} aria-pressed={a.kind==='mark'?selected.includes(t.id):undefined} disabled={a.kind==='build'&&(!a.repeat&&selected.includes(t.id)||selected.length>=(a.maxItems??20))} onClick={()=>select(t.id)}>{a.diagram?.kind==='lines'?a.diagram.segments.find(s=>s.id===t.id)?.label??t.text:t.text}</button>)}</div>}
  {(a.kind!=='write'||a.frame!.some(p=>p.text?.trim()))&&<div className="edu-step-result" role="status" aria-live="polite">
   {a.kind==='write'?<><span>Твоя запись</span><output>{a.frame!.map(p=>p.slotId!==undefined?written[p.slotId]||'…':p.text).join('')}</output></>
    :a.kind==='sort'?a.groups!.map(g=><div key={g.id}><strong>{g.label}</strong><span>{a.tokens.filter(t=>groups[t.id]===g.id).map(t=>t.text).join(' · ')||'—'}</span></div>)
    :a.kind==='build'?<><span>Твоя запись</span><output>{current.length?[' + ',' · '].includes(a.joiner??'')&&current.every(t=>/^\d+$/.test(t??''))?createElement('math',{'aria-label':current.join(a.joiner)},createElement('mrow',null,...current.flatMap((t,i)=>[...(i?[createElement('mo',{key:`o${i}`},a.joiner!.trim())]:[]),createElement('mn',{key:i},t)]))):current.join(a.joiner??' '):'…'}</output></>
     :<><span>Ты выделил</span><output>{current.length?current.join(' · '):'Пока ничего'}</output></>}
  </div>}
  {changed&&<div className="edu-step-actions">{a.kind==='build'&&<button type="button" onClick={()=>setSelected(s=>s.slice(0,-1))}>Убрать последнюю</button>}<button type="button" onClick={()=>{setSelected([]);setGroups({});setWritten({})}}>Сбросить</button></div>}
 </section>
}
export default function ReviewActivity({activity}:{activity:ReviewActivityData}){
 const safe=projectReviewActivity(activity)
 return safe?<Activity key={JSON.stringify(safe)} activity={safe}/>:null
}
