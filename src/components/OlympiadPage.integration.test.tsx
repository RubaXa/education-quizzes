// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OlympiadPage from './OlympiadPage'
import type { FamilyOlympiadTask } from '@/lib/educationStore'
import type { DayDashboardData } from '@/lib/dayDashboardStore'

vi.mock('../DayPage', () => ({ default: ({ token, parent, olympiadScope }: { token: string; parent: boolean; olympiadScope: { olympiadId: string; taskId: string } }) => <div data-token={token} data-role={parent ? 'parent' : 'student'}>{olympiadScope.olympiadId} {olympiadScope.taskId}</div> }))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
const task: FamilyOlympiadTask = { id:'task', title:'Подготовка', dueDate:'2026-11-05', projectionSourceDate:'2026-11-04', learningContext:{kind:'olympiad',id:'o1'}, testTokens:['quiz-token'] }
const watchSelections: typeof import('@/lib/educationStore').watchOlympiadSelections = (_f,_c,next) => { next(['o1']); return () => {} }
const watchCatalog: typeof import('@/lib/educationStore').watchPublicOlympiads = next => { next([{id:'o1',title:'Олимпиада',deadline:null,gradeLevels:[6]}]); return () => {} }
const dashboard = (kind: 'parent' | 'student'): DayDashboardData => ({schemaVersion:1,kind,today:'2026-11-04',timezone:'Europe/Moscow',days:[{date:'2026-11-04',checkedAt:null,complete:true,schedule:[],homework:[],dayToken:`${kind}-day`}]})
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML='';vi.clearAllMocks()})
it.each(['parent','student'] as const)('uses the existing family task and the %s day projection', async role=>{
 const watchTasks=vi.fn((_f,_c,next)=>{next([task]);return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard(role));return ()=>{}})
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent={role==='parent'} dashboardToken="dashboard" watchSelections={watchSelections} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard}/>))
 expect(host.querySelector(`[data-role="${role}"]`)?.getAttribute('data-token')).toBe(`${role}-day`)
 expect(watchTasks.mock.calls[0].slice(0,2)).toEqual(['family','child'])
})
it('rejects a dashboard for the wrong role', async()=>{
 const watchTasks=vi.fn((_f,_c,next)=>{next([task]);return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard('parent'));return ()=>{}})
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent={false} dashboardToken="dashboard" watchSelections={watchSelections} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard}/>))
 expect(host.querySelector('[data-token]')).toBeNull()
})
it('clears the rendered page when the family subscription is revoked', async()=>{
 let fail:(error:Error)=>void=()=>{}
 const watchTasks=vi.fn((_f,_c,next,onError)=>{next([task]);fail=onError;return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard('student'));return ()=>{}})
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent={false} dashboardToken="dashboard" watchSelections={watchSelections} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard}/>))
 expect(host.querySelector('[data-token]')).not.toBeNull()
 await act(async()=>fail(new Error('permission-denied')))
 expect(host.querySelector('[data-token]')).toBeNull()
 expect(host.querySelector('[role=alert]')?.textContent).toContain('Не удалось')
})

it('opens an olympiad without pretending an unpublished practice exists', async()=>{
 const watchTasks=vi.fn((_f,_c,next)=>{next([]);return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard('parent'));return ()=>{}})
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent dashboardToken="parent-board" watchSelections={watchSelections} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard}/>))
 expect(host.textContent).toContain('Олимпиада')
 expect(host.textContent).toContain('Задачи для практики пока не опубликованы')
})

it('does not show an unselected olympiad to the student', async()=>{
 const watchTasks=vi.fn((_f,_c,next)=>{next([task]);return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard('student'));return ()=>{}})
 const empty: typeof watchSelections = (_f,_c,next)=>{next([]);return ()=>{}}
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent={false} dashboardToken="student-board" watchSelections={empty} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard}/>))
 expect(host.textContent).toContain('Эту олимпиаду ещё не включил родитель')
 expect(host.querySelector('[data-token]')).toBeNull()
})

it('reports that practice is not published when only the source intake exists', async()=>{
 const watchTasks=vi.fn((_f,_c,next)=>{next([{...task,id:'intake',sourceIntake:{kind:'olympiad-sheet'}}]);return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard('parent'));return ()=>{}})
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent dashboardToken="dashboard" watchSelections={watchSelections} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard}/>))
 expect(host.textContent).toContain('Задачи для практики пока не опубликованы')
 expect(host.textContent).not.toContain('Можно начинать с любой')
})


it.each(['parent','student'] as const)('shows all published tasks of this olympiad for %s', async role => {
 const watchTasks=vi.fn((_f,_c,next)=>{next([task,{...task,id:'task-2',title:'Вторая задача'},{...task,id:'other',learningContext:{kind:'olympiad',id:'o2'}}]);return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard(role));return ()=>{}})
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent={role==='parent'} dashboardToken="dashboard" watchSelections={watchSelections} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard}/>))
 expect(host.querySelectorAll(`[data-role="${role}"]`)).toHaveLength(2)
 expect(host.textContent).toContain('task-2')
 expect(host.textContent).not.toContain('other')
})

it.each(['parent','student'] as const)('separates uploaded and prepared tasks without duplicating either for %s', async role => {
 const watchTasks=vi.fn((_f,_c,next)=>{next([task,{...task,id:'uploaded',sourcePhotoIds:['photo'],competitionNumber:7},{...task,id:'intake',sourceIntake:{kind:'olympiad-sheet'}}]);return ()=>{}})
 const watchDashboard=vi.fn((_t,next)=>{next(dashboard(role));return ()=>{}})
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent={role==='parent'} dashboardToken="dashboard" watchSelections={watchSelections} watchCatalog={watchCatalog} watchTasks={watchTasks} watchDashboard={watchDashboard} renderPractice={(item,_token,_parent,_target,number)=><span data-id={item.id} data-number={number}>{item.title}</span>}/>))
 const prepared=host.querySelector('[aria-labelledby="olympiad-prepared-title"]')!
 const uploaded=host.querySelector('[aria-labelledby="olympiad-uploaded-title"]')!
 expect(prepared.textContent).toContain('Задачи для подготовки · 1')
 expect(prepared.querySelector('[data-id="task"]')?.getAttribute('data-number')).toBe('1')
 expect(uploaded.textContent).toContain('Загруженные задачи · 1')
 expect(uploaded.querySelector('[data-id="uploaded"]')?.getAttribute('data-number')).toBe('7')
 expect(uploaded.querySelector('[data-id="intake"]')).not.toBeNull()
 expect(host.querySelectorAll('[data-id]')).toHaveLength(3)
})
