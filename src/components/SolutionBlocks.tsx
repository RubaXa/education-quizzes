/** @see ../../docs/modules/reviews/method-guided-solutions.md */
import {createElement,useState,type ReactElement} from 'react'
import type {MathExpression,SolutionBlock,SolutionMethod} from '../../packages/education-presentation/solution-blocks.mjs'
import {projectSolutionBlocks} from '../../packages/education-presentation/solution-blocks.mjs'
import {ReviewVisual} from './ReviewBrief'
import './SolutionBlocks.css'

function MathNode({node}:{node:MathExpression}):ReactElement {
 if(node.kind==='row')return createElement('mrow',null,...node.items.map((n,i)=>createElement(MathNode,{node:n,key:i})))
 if(node.kind==='fraction')return createElement('mfrac',null,createElement(MathNode,{node:node.numerator}),createElement(MathNode,{node:node.denominator}))
 if(node.kind==='power')return createElement('msup',null,createElement(MathNode,{node:node.base}),createElement(MathNode,{node:node.exponent}))
 return createElement({number:'mn',symbol:'mi',operator:'mo',text:'mtext'}[node.kind],null,node.value)
}
export function MethodFlow({label,steps}:{label:string;steps:string[]}){
 return <ol className="edu-method-flow" aria-label={label}>{steps.map((step,i)=><li key={i}><span>{i+1}</span>{step}{i<steps.length-1&&<svg viewBox="0 0 24 12" aria-hidden="true"><path d="M0 6h21m-5-5 5 5-5 5"/></svg>}</li>)}</ol>
}
export function MethodOverview({method}:{method:SolutionMethod}){
 return <section className="edu-method-overview" aria-label="Метод решения"><h4>{method.name}</h4><p>{method.reason}</p><MethodFlow label="Путь решения" steps={method.steps}/></section>
}
function Cases({block}:{block:Extract<SolutionBlock,{kind:'cases'}>}){
 const [selected,setSelected]=useState(0),active=block.cases[selected]??block.cases[0]
 return <section className="edu-solution-cases" aria-label={block.label}><h5>{block.label}</h5>
  <div className="edu-solution-case-choices" role="group" aria-label="Выбрать случай">{block.cases.map((item,i)=><button type="button" key={item.label} aria-pressed={i===selected} onClick={()=>setSelected(i)}>{item.label}</button>)}</div>
  <div className="edu-solution-selected-case" aria-live="polite"><SolutionBlocks blocks={active.blocks}/><p className="edu-solution-conclusion">{active.result}</p></div>
 </section>
}
function Grid({block}:{block:Extract<SolutionBlock,{kind:'grid'}>}){
 const cell=24,offset=block.columnLabels||block.rowLabels?24:0
 return <figure className="edu-solution-grid"><figcaption>{block.label}</figcaption><svg viewBox={`0 0 ${block.columns*cell+offset} ${block.rows*cell+offset}`} role="img" aria-label={block.label}>{block.columnLabels?.map((v,i)=><text key={`c${i}`} x={offset+i*cell+12} y={12} dominantBaseline="central" textAnchor="middle">{v}</text>)}{block.rowLabels?.map((v,i)=><text key={`r${i}`} x={12} y={offset+i*cell+12} dominantBaseline="central" textAnchor="middle">{v}</text>)}<g transform={`translate(${offset} ${offset})`}>{block.cells.map((c,i)=><g key={i}><rect className={`edu-grid-${c.mark}`} x={c.column*cell+1} y={c.row*cell+1} width={cell-2} height={cell-2}/>{c.mark==='cut'&&<path d={`M${c.column*cell+5} ${c.row*cell+5}l14 14m0-14-14 14`}/>} {c.label&&<text x={c.column*cell+cell/2} y={c.row*cell+cell/2} dominantBaseline="central" textAnchor="middle">{c.label}</text>}</g>)}</g></svg></figure>
}
function Graph({block}:{block:Extract<SolutionBlock,{kind:'graph'}>}){
 const nodes=new Map(block.nodes.map(n=>[n.id,n]))
 return <figure className="edu-solution-graph"><figcaption>{block.label}</figcaption><div className="edu-solution-graph-canvas" role="img" aria-label={block.label}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{block.edges.map((edge,i)=>{const from=nodes.get(edge.from)!,to=nodes.get(edge.to)!;return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke"/>})}</svg>{block.nodes.map(n=><div className="edu-solution-graph-node" key={n.id} style={{left:`${n.x}%`,top:`${n.y}%`}}><span/><small>{n.label}</small></div>)}</div></figure>
}
export default function SolutionBlocks({blocks}:{blocks:SolutionBlock[]}){
 const safe=projectSolutionBlocks(blocks)
 if(!safe)return null
 return <div className="edu-solution-blocks">{safe.map((block,i)=>{
  if(block.kind==='text')return <section key={i} className="edu-solution-text">{block.title&&<h5>{block.title}</h5>}<p>{block.text}</p></section>
  if(block.kind==='formula')return <figure className="edu-solution-formula" key={i}><figcaption>{block.label}</figcaption>{createElement('math',{display:'block','aria-label':block.label},createElement(MathNode,{node:block.expression}))}</figure>
  if(block.kind==='visual')return <ReviewVisual visual={block.visual} key={i}/>
  if(block.kind==='source')return <a className="edu-solution-source" href={block.url} key={i} target="_blank" rel="noopener noreferrer">{block.label}</a>
  if(block.kind==='grid')return <Grid block={block} key={i}/>
  if(block.kind==='graph')return <Graph block={block} key={i}/>
  if(block.kind==='flow')return <MethodFlow key={i} label={block.label} steps={block.steps}/>
  return <Cases key={i} block={block}/>
 })}</div>
}
