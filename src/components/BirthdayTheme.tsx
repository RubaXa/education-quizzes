/** @see ../../docs/decisions/birthday-theme-2026-11-14.md */
/** @see ../../docs/modules/families/README.md#birthday */
import { useEffect, useState, type ReactNode } from 'react'
import type { PersonalChild } from '@/lib/personalAccess'
import './BirthdayTheme.css'

function birthdayToday(child: Pick<PersonalChild, 'birthday' | 'timezone'>, now: Date) {
  const date = child.birthday
  if (!date || !/^\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`2000-${date}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(5, 10) !== date) return false
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: child.timezone || 'Europe/Moscow', month: '2-digit', day: '2-digit' }).formatToParts(now)
    return `${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}` === date
  } catch { return false }
}

export function BirthdayGreeting({ name }: { name: string }) {
  return <section className="birthday-greeting" aria-label="Поздравление Education">
    <span className="birthday-greeting-icon" aria-hidden="true">🎉</span>
    <div><p className="birthday-greeting-eyebrow">Сегодня твой день</p><h2>С днём рождения, {name}!</h2><p>Пусть будет больше радости, друзей и удивительных открытий.</p></div>
    <span className="birthday-greeting-stars" aria-hidden="true">✦ ✧ ✦</span>
  </section>
}

export default function BirthdayTheme({ child, children }: { child: PersonalChild; children: ReactNode }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const celebrating = birthdayToday(child, now)
  // Stable subtree position keeps drafts and disclosures intact at midnight.
  return <div className={celebrating ? 'birthday-learning birthday-learning-active' : 'birthday-learning'}>
    {celebrating && <BirthdayGreeting name={child.displayName} />}
    <div className="birthday-learning-content">{children}</div>
  </div>
}
