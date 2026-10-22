/** @see ../../docs/modules/families/early-development.md */
import { useEffect, useState } from 'react'
import type { PersonalChild } from '@/lib/personalAccess'
import { saveEarlyObservation, watchEarlyJournal, watchEarlyPlan, type EarlyPlan } from '@/lib/earlyDevelopmentStore'
import type { Observation } from '@/lib/earlyDevelopment'
import EarlyDevelopment from './EarlyDevelopment'

export default function EarlyDevelopmentPage({ child }: { child: PersonalChild }) {
  const [plan, setPlan] = useState<EarlyPlan | null>(null)
  const [entries, setEntries] = useState<Observation[] | null>(null)
  const [error, setError] = useState('')
  const [windowSize, setWindowSize] = useState(200)
  useEffect(() => {
    const failed = () => setError('Не удалось подтвердить доступ к раннему развитию. Проверьте подключение и повторите вход в профиль родителя.')
    const stop = watchEarlyPlan(child, setPlan, failed)
    const journal = watchEarlyJournal(child, windowSize, setEntries, failed)
    return () => { stop(); journal() }
  }, [child.familyId, child.childId, windowSize])
  if (error) return <p role="alert">{error}</p>
  if (!plan || !entries) return <p role="status">Открываем программу и дневник…</p>
  return <><a className="early-text-button" href="#/">← Все дети</a><EarlyDevelopment live={{ plan, child, entries, save: (entry, previous) => saveEarlyObservation(child, entry, previous), loadMore: entries.length >= windowSize ? () => setWindowSize((size) => size + 200) : undefined }} /></>
}
