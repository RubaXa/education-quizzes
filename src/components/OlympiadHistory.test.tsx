// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach,expect,it,vi } from 'vitest'
import OlympiadHistory from './OlympiadHistory'
import type { HistoryCompetition } from '@/lib/olympiad/historyTypes'
vi.mock('@/lib/olympiad/historyStore',()=>({requestHistoryFile:vi.fn()}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:ReturnType<typeof createRoot>|undefined;const host=document.createElement('div')
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML=''})
const example:HistoryCompetition={id:'demo',title:'Пример',aliases:[],seasons:[{id:'2025-26',label:'2025/26',grade:'5',stages:[{id:'qualifier',label:'Отбор',date:null,score:18,maximum:30,state:'preliminary',award:null,rank:null,notes:[],parentNotes:['Закрытая заметка'],files:[{id:'a'.repeat(64),name:'Решение.pdf',contentType:'application/pdf',size:10,role:'solution',studentVisible:true}],tasks:[{number:1,score:0,maximum:null,statement:'Полное исходное условие.',fileIds:['a'.repeat(64)]}]}]}]}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
it('opens seasons and stages lazily, keeps zero and links work to the selected task',async()=>{
 const read=vi.fn(async()=> 'https://downloader.disk.yandex.net/synthetic');document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadHistory familyId="f" childId="c" parent={false} competition={example} resolveFile={read}/>))
 expect(read).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Закрытая заметка')
 await act(async()=>{const stage=host.querySelector<HTMLDetailsElement>('.olympiad-history-stage')!;stage.open=true;stage.dispatchEvent(new Event('toggle'));await tick()})
 expect(read).toHaveBeenCalledWith('f','c','a'.repeat(64));expect(host.textContent).toContain('Предварительный результат');expect(host.textContent).toContain('18 из 30')
 await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Открыть №1')!.click();await tick()})
 expect(host.textContent).toContain('Полное исходное условие.');expect(host.querySelector('tbody td')?.textContent).toBe('0');expect(host.querySelector('input[type=file]')).toBeNull();expect(host.querySelector('.artifact-avatar-indicator')).toBeNull();expect(host.textContent).not.toContain('проверено');await act(async()=>{host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click();await tick()});expect(host.querySelector<HTMLAnchorElement>('a[target=_blank]')?.href).toContain('downloader.disk.yandex.net')
})
it('shows an explicit retry when a private original cannot be read',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<OlympiadHistory familyId="f" childId="c" parent competition={example} resolveFile={async()=>{throw Error('denied')}}/>))
 await act(async()=>{const stage=host.querySelector<HTMLDetailsElement>('.olympiad-history-stage')!;stage.open=true;stage.dispatchEvent(new Event('toggle'));await tick()})
 expect(host.querySelector('[role=alert]')?.textContent).toContain('Недоступно файлов: 1');expect(host.textContent).toContain('Повторить')
})
