// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OlympiadWrittenPractice from './OlympiadWrittenPractice'
import { olympiadRequest } from '@/lib/olympiad/client'
import { olympiadPhoto } from '@/lib/olympiad/photoClient'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
URL.createObjectURL=vi.fn(()=> 'blob:private-photo')
URL.revokeObjectURL=vi.fn()
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
const scope={familyId:'f',childId:'c',olympiadId:'o',problemId:'p'}, problem={id:'p',title:'Перебор',statement:'Найди варианты.'}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML='';vi.clearAllMocks()})
it('uploads privately, selects the same gallery photo, and submits a help request',async()=>{
 let stored=false, submitted=false
 const request=vi.fn(async (body:Record<string,unknown>)=>{
  if(body.action==='list-help')return {photos:stored?[{id:'photo'}]:[],requests:submitted?[{requestId:'r',status:'requested',revision:1}]:[]} as never
  if(body.action==='read-help')return {status:'requested',revision:1,revisions:[{revision:1,photoIds:['photo'],note:''}],answers:[]} as never
  if(body.action==='submit-help'){submitted=true;return {revision:1} as never}
  throw Error('unexpected')
 }) as typeof olympiadRequest
 const photo=vi.fn(async (action:string)=>{if(action==='photo-upload'){stored=true;return {photoId:'photo'}}return new Blob(['image'],{type:'image/jpeg'})}) as typeof olympiadPhoto
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadWrittenPractice scope={scope} problem={problem} number={1} parent={false} request={request} photo={photo}/>))
 const input=host.querySelector<HTMLInputElement>('input[type=file]')!
 const file=new File(['image'],'photo.jpg',{type:'image/jpeg'})
 await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(vi.mocked(photo).mock.calls[0][0]).toBe('photo-upload')
 expect(host.querySelector<HTMLImageElement>('img[src="blob:private-photo"]')).not.toBeNull()
 const detail=host.querySelector<HTMLDetailsElement>('.problem-statement-help')!;await act(async()=>{detail.open=true;detail.dispatchEvent(new Event('toggle'))})
 const choose=host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;await act(async()=>choose.click())
 const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent==='Попросить помощь')!
 expect(button.disabled).toBe(false);await act(async()=>button.click())
 expect(host.textContent).toContain('Помощь запрошена')
 const sent=vi.mocked(request).mock.calls.find(call=>call[0].action==='submit-help')?.[0].request as {photoIds:string[];familyId:string}
 expect(sent.photoIds).toEqual(['photo']);expect(sent.familyId).toBe('f')
})
it('shows the parent the saved question and answer without upload or submit controls',async()=>{
 const request=vi.fn(async (body:Record<string,unknown>)=>{
  if(body.action==='list-help')return {photos:[{id:'photo'}],requests:[{requestId:'r',status:'answered',revision:1}]} as never
  if(body.action==='read-help')return {status:'answered',revision:1,revisions:[{revision:1,photoIds:[],note:'Где ошибка?'}],answers:[{revision:1,text:'Попробуй выписать варианты.'}]} as never
  throw Error('unexpected')
 }) as typeof olympiadRequest
 const photo=vi.fn(async()=>new Blob(['image'],{type:'image/jpeg'})) as typeof olympiadPhoto
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadWrittenPractice scope={scope} problem={problem} number={1} parent request={request} photo={photo}/>))
 expect(host.querySelector<HTMLImageElement>('img[src="blob:private-photo"]')).not.toBeNull()
 expect(host.textContent).toContain('Где ошибка?');expect(host.textContent).toContain('Попробуй выписать варианты.')
 expect(host.querySelector('input[type=file]')).toBeNull();expect(vi.mocked(request).mock.calls.some(call=>call[0].action==='submit-help')).toBe(false)
})
