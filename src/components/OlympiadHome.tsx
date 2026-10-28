import { useEffect, useState } from 'react'
import OlympiadCatalog from './OlympiadCatalog'
import { traceOlympiad } from '@/lib/browserAccessTrace'
import { olympiadEndpoint, olympiadRequest, type OlympiadCatalogItem } from '@/lib/olympiad/client'

/** The LearningRoute provides a membership-checked child. The server checks it again.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#назначение-и-границы */
export default function OlympiadHome({ familyId, childId, parent, dashboardToken }: { familyId: string; childId: string; parent: boolean; dashboardToken: string }) {
  const [items,setItems] = useState<OlympiadCatalogItem[]>([])
  const [error,setError] = useState(false)
  useEffect(() => {
    let active = true
    setItems([]);setError(false)
    if (olympiadEndpoint()) void olympiadRequest<OlympiadCatalogItem[]>({action:'list',familyId,childId}).then(data=>{if(active && Array.isArray(data)){setItems(data);traceOlympiad('list-loaded','product',parent?'parent':'student',data.length)}}).catch(()=>{if(active){setItems([]);setError(true);traceOlympiad('list-failed','product',parent?'parent':'student')}})
    return () => { active=false }
  },[familyId,childId,parent])
  if (error) return <p role="status">Не удалось загрузить олимпиады. Обновите страницу, чтобы повторить.</p>
  return <OlympiadCatalog items={items} parent={parent} onExpand={open=>traceOlympiad(open?'list-opened':'list-closed','product',parent?'parent':'student')} onOpen={id=>{traceOlympiad('opened','product',parent?'parent':'student');window.location.hash=`#/olympiad/${encodeURIComponent(dashboardToken)}/${encodeURIComponent(id)}`}} onParticipation={async (id,enabled)=>{
    try { await olympiadRequest({action:'participation',scope:{familyId,childId,olympiadId:id,attemptId:'catalog'},enabled});traceOlympiad('participation-changed','product','parent') } catch (cause) {traceOlympiad('participation-failed','product','parent');throw cause}
    const refreshed = await olympiadRequest<OlympiadCatalogItem[]>({action:'list',familyId,childId})
    setItems(refreshed)
  }}/>
}
