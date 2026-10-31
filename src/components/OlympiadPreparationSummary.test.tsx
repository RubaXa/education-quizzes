// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach,expect,it,vi } from 'vitest'
import OlympiadPreparationSummary from './OlympiadPreparationSummary'
import type { PersonalPreparation } from '@/lib/olympiad/historyTypes'
vi.mock('@/lib/olympiad/historyStore',()=>({requestHistoryFile:vi.fn()}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
const example:PersonalPreparation={updatedOn:'2026-10-31',strengths:[{text:'Составляешь модель.',evidenceIds:['work']}],workingOn:[{text:'Обосновать полноту.',evidenceIds:[]}],next:{taskId:'next',title:'Задача для продолжения',reason:'Закончить принятый способ.',evidenceIds:[]},evidence:[{id:'work',label:'Прошлый сезон · №2',competitionId:'demo',seasonId:'2025',stageId:'qualifier',taskNumber:2,file:{id:'a'.repeat(64),name:'Работа.pdf',contentType:'application/pdf',size:20,role:'solution',studentVisible:true}}]}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host.remove();host.innerHTML=''})
it('shows one next step and lazily opens the referenced original in the shared gallery',async()=>{
 const open=vi.fn(),read=vi.fn(async()=> 'https://downloader.disk.yandex.net/synthetic');document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPreparationSummary preparation={example} familyId="f" childId="c" availableTaskIds={['next']} onOpenTask={open} resolveFile={read}/>))
 expect(read).not.toHaveBeenCalled();expect(host.textContent).toContain('Уже получается');expect(host.textContent).toContain('Над чем работаем')
 await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Открыть задачу')!.click()});expect(open).toHaveBeenCalledWith('next')
 await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Прошлый сезон · №2')!.click();await tick()})
 expect(read).toHaveBeenCalledWith('f','c','a'.repeat(64));expect(host.querySelector<HTMLAnchorElement>('a[target=_blank]')?.href).toContain('downloader.disk.yandex.net');expect(host.querySelector('input[type=file]')).toBeNull();expect(host.textContent).not.toContain('Исходник остаётся');expect(host.querySelector('.artifact-avatar-indicator')).toBeNull()
})
it('has no dead task action when practice is unavailable and clears a selected original after child change',async()=>{
 const read=vi.fn(async()=> 'https://downloader.disk.yandex.net/synthetic');document.body.append(host);root=createRoot(host)
 const render=(childId:string)=>root!.render(<OlympiadPreparationSummary preparation={example} familyId="f" childId={childId} availableTaskIds={[]} onOpenTask={vi.fn()} resolveFile={read}/>)
 await act(async()=>render('c'));expect(host.textContent).toContain('пока недоступна');expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Открыть задачу')).toBe(false)
 await act(async()=>{host.querySelector<HTMLButtonElement>('button')!.click();await tick()});expect(host.querySelector('[role=region]')).not.toBeNull()
 await act(async()=>render('other'));expect(host.querySelector('[role=region]')).toBeNull()
})
it('shows checked achievements and opens the existing work history, with an explicit exhausted route',async()=>{
 document.body.append(host);root=createRoot(host);const open=vi.fn()
 const preparation:PersonalPreparation={...example,next:null,workingOn:[],progress:{exhausted:true,tasks:[{taskId:'done',title:'Зачтённая задача',status:'verified',reviewVersion:'b'.repeat(64),checkedOn:'2026-11-01',credited:'review',confirmed:'Рассмотрены все случаи.',focus:null,achievedOn:'2026-11-01'}]}}
 await act(async()=>root!.render(<OlympiadPreparationSummary preparation={preparation} familyId="f" childId="c" availableTaskIds={['done']} onOpenTask={open}/>))
 expect(host.textContent).toContain('Все задачи этого маршрута зачтены.');expect(host.querySelector('summary')?.textContent).toContain('зачтено 1')
 await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.startsWith('Работа и история'))!.click()})
 expect(open).toHaveBeenCalledWith('done');expect(host.textContent).not.toContain('Открыть задачу')
})
it('keeps the archived basis reachable when the task action is already in the overview',async()=>{
 const read=vi.fn(async()=> 'https://downloader.disk.yandex.net/synthetic');document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPreparationSummary nextPresented preparation={{...example,next:{...example.next!,evidenceIds:['work']}}} familyId="f" childId="c" availableTaskIds={['next']} onOpenTask={vi.fn()} resolveFile={read}/>))
 expect(host.querySelector('.olympiad-preparation-next')).toBeNull()
 expect(host.textContent).not.toContain('Закончить принятый способ.')
 await act(async()=>{host.querySelector<HTMLButtonElement>('.olympiad-preparation-next-evidence button')!.click();await tick()})
 expect(read).toHaveBeenCalledWith('f','c','a'.repeat(64))
})
