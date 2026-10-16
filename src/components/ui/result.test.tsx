/// <reference types="node" />
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ResultBadge, ResultMeter, ResultPoints } from './result'
/** @see ../../../docs/product/result-presentation-proposal.md */
describe('shared result primitives',()=>{
  it('renders one tone in badge, points and meter',()=>{
    const input={kind:'score' as const,points:34,maxPoints:39}
    for(const html of [renderToStaticMarkup(<ResultBadge input={input}/>),renderToStaticMarkup(<ResultPoints points={34} maxPoints={39}/>),renderToStaticMarkup(<ResultMeter input={input} label="Результат"/>)])expect(html).toContain('edu-result-tone-success')
    expect(renderToStaticMarkup(<ResultMeter input={input} label="Результат"/>)).toContain('role="meter"')
    expect(renderToStaticMarkup(<ResultMeter input={{kind:'answers',answered:5,total:5}} label="Ответы"/>)).toContain('role="progressbar"')
    expect(renderToStaticMarkup(<ResultMeter input={{kind:'waiting'}} label="Результат"/>)).toBe('')
  })
  it('preserves zero length, visible numeric text and unknown instead of invented zero',()=>{
    expect(renderToStaticMarkup(<ResultMeter input={{kind:'score',points:0,maxPoints:7}} label="Результат"/>)).toContain('width:0%')
    expect(renderToStaticMarkup(<ResultBadge input={{kind:'score',points:0,maxPoints:7}}/>)).toContain('0%')
    expect(renderToStaticMarkup(<ResultPoints maxPoints={7}/>)).toContain('—')
  })
  it('uses only global semantic colour pairs with sufficient text and meter contrast',()=>{
    const css=readFileSync(new URL('../../education-design-tokens.css',import.meta.url),'utf8')
    const tokens=Object.fromEntries([...css.matchAll(/(--edu-[\w-]+):\s*([^;]+);/g)].map(([,name,value])=>[name,value]))
    const resolve=(name:string):string=>tokens[name].startsWith('var(')?resolve(tokens[name].slice(4,-1)):tokens[name]
    const lum=(hex:string)=>hex.slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0)
    for(const role of ['success','attention','error','waiting','accent','neutral']){
      const ink=lum(resolve(`--edu-status-${role}-ink`)),bg=lum(resolve(`--edu-status-${role}-bg`));expect((Math.max(ink,bg)+.05)/(Math.min(ink,bg)+.05)).toBeGreaterThanOrEqual(4.5)
    }
    const componentCss=readFileSync(new URL('./result.css',import.meta.url),'utf8')
    expect(componentCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(componentCss).toContain('var(--edu-status-success-ink)')
    const appCss=readFileSync(new URL('../../App.css',import.meta.url),'utf8')
    expect(appCss).not.toMatch(/\.score-panel\s*>\s*span\s*\{[^}]*color:/)
  })
})
