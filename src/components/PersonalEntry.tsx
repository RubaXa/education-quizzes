import { useEffect, useState } from 'react'
import { ArrowRight, KeyRound } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { loadPersonalProfile, redeemPersonalLink, restorePersonalSession } from '../lib/personalAccess'
import type { PersonalProfile } from '../lib/personalAccess'

function accessError(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    if (cause.code === 'auth/operation-not-allowed' || cause.code === 'auth/configuration-not-found') {
      return 'Вход по личным ссылкам ещё не включён в Firebase.'
    }
    if (cause.code === 'permission-denied') return 'Личная ссылка закрыта или отозвана. Попросите новую ссылку.'
  }
  return cause instanceof Error ? cause.message : 'Не удалось открыть личный профиль.'
}

/** @see ../../docs/architecture/family-data-model.md#link-login */
export function PersonalEntry({ initialLink }: { initialLink?: string }) {
  const [link, setLink] = useState('')
  const [profile, setProfile] = useState<PersonalProfile | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const open = async () => {
      try {
        // The bearer secret is removed from browser history as soon as we have captured it.
        if (initialLink) history.replaceState(null, '', `${location.pathname}${location.search}#/`)
        const session = initialLink ? await redeemPersonalLink(initialLink) : await restorePersonalSession()
        if (!alive) return
        if (session) setProfile(await loadPersonalProfile(session))
      } catch (cause) {
        if (alive) setError(accessError(cause))
      } finally {
        if (alive) setBusy(false)
      }
    }
    void open()
    return () => { alive = false }
  }, [initialLink])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const session = await redeemPersonalLink(link)
      setProfile(await loadPersonalProfile(session))
      setLink('')
    } catch (cause) {
      setError(accessError(cause))
    } finally { setBusy(false) }
  }

  if (profile) return <div className="personal-entry">
    <div className="personal-entry-hero">
      <span className="personal-entry-icon">✳</span>
      <div><h1>Здравствуйте, {profile.displayName}</h1><p>Ваши учебные страницы</p></div>
    </div>
    {profile.children.length === 0 && <Card><CardContent className="py-8">Связь с учеником ещё не опубликована.</CardContent></Card>}
    <div className="personal-child-list">{profile.children.map((child) => <Card key={`${child.familyId}-${child.childId}`}>
      <CardHeader><CardTitle>{child.displayName}</CardTitle><CardDescription>{child.role === 'parent' ? 'Родительский доступ' : 'Ученический доступ'}</CardDescription></CardHeader>
      <CardContent>{child.dayToken
        ? <Button asChild><a href={`#/day${child.role === 'parent' ? '-parent' : ''}/${child.dayToken}`}>Открыть учебный день <ArrowRight /></a></Button>
        : <p className="text-muted-foreground">Страницы ребёнка ещё переносятся в новый профиль.</p>}
      </CardContent>
    </Card>)}</div>
  </div>

  return <Card className="personal-login mx-auto max-w-2xl">
    <CardHeader>
      <div className="personal-entry-icon"><KeyRound /></div>
      <CardTitle>Вход по личной ссылке</CardTitle>
      <CardDescription>У каждого родителя и ребёнка своя ссылка. Вставьте её один раз на этом устройстве.</CardDescription>
    </CardHeader>
    <CardContent>
      <form onSubmit={submit} className="personal-login-form">
        <Input aria-label="Личная ссылка Education" autoComplete="off" placeholder="Личная ссылка Education" value={link} onChange={(event) => setLink(event.target.value)} />
        <Button type="submit" disabled={busy || !link.trim()}>{busy ? 'Открываем…' : 'Открыть'}</Button>
      </form>
      {busy && !link && <p className="text-muted-foreground">Проверяем доступ…</p>}
      {error && <p role="alert" className="personal-login-error">{error}</p>}
    </CardContent>
  </Card>
}
