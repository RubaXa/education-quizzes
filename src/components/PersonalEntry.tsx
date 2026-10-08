import { useEffect, useState } from 'react'
import { ArrowRight, Check, Copy, KeyRound, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { loadPersonalProfile, personalEntryUrl, redeemPersonalLink, restorePersonalSession } from '../lib/personalAccess'
import type { PersonalProfile, PersonalSession } from '../lib/personalAccess'

function accessError(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    if (cause.code === 'auth/operation-not-allowed' || cause.code === 'auth/configuration-not-found') {
      return 'Вход по личным ссылкам ещё не включён в Firebase.'
    }
    if (cause.code === 'permission-denied') return 'Личная ссылка закрыта или отозвана. Попросите новую ссылку.'
    if (cause.code === 'auth/network-request-failed' || cause.code === 'unavailable') {
      return 'Не удалось связаться с Firebase. Проверьте интернет и повторите вход.'
    }
  }
  return cause instanceof Error ? cause.message : 'Не удалось открыть личный профиль.'
}

/** @see ../../docs/architecture/family-data-model.md#link-login */
export function PersonalEntry({ initialLink }: { initialLink?: string }) {
  const [link, setLink] = useState('')
  const [profile, setProfile] = useState<PersonalProfile | null>(null)
  const [session, setSession] = useState<PersonalSession | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const reconnect = () => { setOnline(true); if (!profile) setRetry((value) => value + 1) }
    const disconnect = () => setOnline(false)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnect)
    return () => {
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', disconnect)
    }
  }, [profile])

  useEffect(() => {
    let alive = true
    const open = async () => {
      setBusy(true)
      setError('')
      try {
        // The bearer secret is removed from browser history as soon as we have captured it.
        if (initialLink) history.replaceState(null, '', `${location.pathname}${location.search}#/`)
        const restored = initialLink ? await redeemPersonalLink(initialLink) : await restorePersonalSession()
        if (!alive) return
        if (restored) {
          const nextProfile = await loadPersonalProfile(restored)
          if (alive) { setSession(restored); setProfile(nextProfile) }
        }
      } catch (cause) {
        if (alive) setError(accessError(cause))
      } finally {
        if (alive) setBusy(false)
      }
    }
    void open()
    return () => { alive = false }
  }, [initialLink, retry])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const redeemed = await redeemPersonalLink(link)
      setProfile(await loadPersonalProfile(redeemed))
      setSession(redeemed)
      setLink('')
    } catch (cause) {
      setError(accessError(cause))
    } finally { setBusy(false) }
  }

  const copyPersonalLink = async () => {
    if (!session) return
    try {
      await navigator.clipboard.writeText(personalEntryUrl(session))
      setCopied(true)
      setError('')
    } catch {
      setError('Не удалось скопировать ссылку. Откройте исходную личную ссылку и скопируйте её вручную.')
    }
  }

  if (profile) return <div className="personal-entry">
    <div className="personal-entry-hero">
      <span className="personal-entry-icon">✳</span>
      <div><h1>Здравствуйте, {profile.displayName}</h1><p>Ваши учебные страницы</p></div>
    </div>
    <div className="personal-install-hint">
      <div><strong>Education на iPhone</strong><p>Перед добавлением на экран «Домой» скопируйте личную ссылку. При первом запуске с иконки вставьте её один раз.</p></div>
      <Button type="button" variant="outline" onClick={() => void copyPersonalLink()}>{copied ? <Check /> : <Copy />}{copied ? 'Ссылка скопирована' : 'Скопировать личную ссылку'}</Button>
    </div>
    {error && <p role="alert" className="personal-login-error">{error}</p>}
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
      {!online && <p role="status" className="personal-offline">Нет сети. Приложение открылось, но личный план загрузится после подключения.</p>}
      {error && <p role="alert" className="personal-login-error">{error}</p>}
      {error && <Button type="button" variant="outline" className="mt-3" onClick={() => setRetry((value) => value + 1)} disabled={busy}><RefreshCw /> Повторить</Button>}
    </CardContent>
  </Card>
}
