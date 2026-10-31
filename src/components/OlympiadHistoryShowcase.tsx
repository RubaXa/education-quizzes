import OlympiadHistory from './OlympiadHistory'
import OlympiadPreparationSummary from './OlympiadPreparationSummary'
import { useState } from 'react'
import { Button } from './ui/button'
import {olympiadHistoryExample as example,resolveDemoHistoryFile as demoFile} from '@/ui-kit/olympiadHistoryFixtures'
/** Synthetic fixtures only; never a real child's history in public UI Kit.
 * @see ../../docs/shared/design/ui-kit.md
 * @see ../../docs/modules/assessments/olympiad-history.md */
export default function OlympiadHistoryShowcase(){
 const [parent,setParent]=useState(true),[opened,setOpened]=useState(false)
 function openTask(){setOpened(true);document.getElementById('demo-personal-task')?.scrollIntoView({block:'center'})}
 return <><div className="edu-kit-presets"><Button variant="outline" aria-pressed={parent} onClick={()=>setParent(true)}>Родитель</Button><Button variant="outline" aria-pressed={!parent} onClick={()=>setParent(false)}>Ученик</Button></div>
 <div className="olympiad-page"><div className="day-dashboard-card olympiad-page-body"><OlympiadPreparationSummary key={parent?'preparation-parent':'preparation-student'} preparation={example.preparation!} familyId="demo" childId="demo" availableTaskIds={['demo-next']} onOpenTask={openTask} resolveFile={demoFile}/></div></div>
 <OlympiadHistory key={parent?'parent':'student'} competition={example} familyId="demo" childId="demo" parent={parent} resolveFile={demoFile}/>
 <div id="demo-personal-task" data-preparation-next={opened?'opened':'waiting'}><h3>№4 · Продолжение рассуждения</h3><p>{opened?'Задача открыта. Начни с одного следующего шага.':'Демонстрация перехода к существующей практике.'}</p></div></>
}
