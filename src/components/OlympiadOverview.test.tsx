// @vitest-environment jsdom
/** @see ../../docs/shared/design/information-hierarchy.md */
import {act} from 'react'
import{createRoot}from'react-dom/client'
import{expect,it,vi}from'vitest'
import OlympiadOverview,{olympiadHeading}from'./OlympiadOverview'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
it('moves only the exact known subject and season suffix, without truncating other names',()=>{
 expect(olympiadHeading('Длинное название — математика 2026–2027','Математика')).toEqual({title:'Длинное название',meta:'Математика · 2026–2027'})
 expect(olympiadHeading('Необычное — название с датой','Математика').title).toBe('Необычное — название с датой')
})
it('keeps a single first-level deadline and reachable practice without changing the route',async()=>{
 const host=document.createElement('div'),root=createRoot(host),scroll=vi.fn();document.body.append(host)
 const calendar={checkedAt:'2026-10-31T12:00:00Z',registrationUrl:'https://example.org/',registrationNote:'Регистрация в кабинете',events:[{id:'deadline',title:'Приём решений',at:'2026-11-05T23:59:59Z',sourceUrl:'https://example.org/'}],notes:['Сохранённое правило'],preparation:['Один шаг'],sources:[]}
 vi.stubGlobal('matchMedia',()=>({matches:true}));vi.stubGlobal('location',{hash:'#/olympiad/board/id'})
 try{
  await act(async()=>root.render(<><OlympiadOverview olympiad={{title:'Название — математика 2026–2027',subject:'Математика',schedule:'ДУБЛЬ ДАТЫ',calendar}} sections={[{id:'practice',label:'Практика',count:7}]}/><h2 id="practice" tabIndex={-1}>Практика</h2></>))
  const target=host.querySelector<HTMLElement>('#practice')!;target.scrollIntoView=scroll
  expect(host.textContent).not.toContain('ДУБЛЬ ДАТЫ')
  expect(host.querySelectorAll('details')).toHaveLength(2)
  expect(host.querySelector('details')?.open).toBe(false)
  expect(host.querySelector('.olympiad-registration')?.getAttribute('href')).toBe('https://example.org/')
  expect(host.textContent).not.toContain('Тумблер')
  expect(host.textContent).toContain('Сохранённое правило')
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-controls="practice"]')!.click())
  expect(scroll).toHaveBeenCalled();expect(document.activeElement).toBe(target)
  expect(location.hash).toBe('#/olympiad/board/id')
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
