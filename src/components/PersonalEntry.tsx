import { useEffect, useRef, useState } from 'react'
import { Check, ClipboardPaste, Copy, KeyRound } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { loadPersonalProfile, personalEntryUrl, redeemPersonalLink, restorePersonalSession, secretFromPastedPersonalLink } from '../lib/personalAccess'
import type { PersonalProfile, PersonalSession } from '../lib/personalAccess'
import DayDashboard from '../DayDashboard'

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
  const [selectedChild, setSelectedChild] = useState<string | null>(null)
  const [manualEntry, setManualEntry] = useState(false)
  const manualInput = useRef<HTMLInputElement>(null)

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

  const openLink = async (value: string) => {
    setBusy(true)
    setError('')
    try {
      const redeemed = await redeemPersonalLink(secretFromPastedPersonalLink(value))
      setProfile(await loadPersonalProfile(redeemed))
      setSession(redeemed)
      setLink('')
    } catch (cause) {
      setError(accessError(cause))
    } finally { setBusy(false) }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    void openLink(link)
  }

  const showNativePaste = () => {
    setManualEntry(true)
    // Safari does not grant persistent clipboard-read permission. Its native
    // Paste action on an editable field is the reliable fallback on iPhone.
    window.setTimeout(() => manualInput.current?.focus(), 0)
  }

  const pasteLink = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text/plain')
    if (!pasted) return
    event.preventDefault()
    setLink(pasted)
    void openLink(pasted)
  }

  const openFromClipboard = async () => {
    setError('')
    setBusy(true)
    try {
      if (!navigator.clipboard?.readText) {
        showNativePaste()
        setError('iPhone не разрешил чтение буфера кнопкой. Нажмите «Вставить» в открывшемся поле — ссылка проверится сразу.')
        return
      }
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setError('Буфер обмена пуст. Скопируйте личную ссылку профиля и нажмите кнопку ещё раз.')
        return
      }
      await openLink(text)
    } catch {
      showNativePaste()
      setError('iPhone не разрешил чтение буфера кнопкой. Нажмите «Вставить» в открывшемся поле — ссылка проверится сразу.')
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

  if (profile) {
    const available = profile.children.filter((child) => child.dashboardToken)
    const child = available.find((item) => `${item.familyId}/${item.childId}` === selectedChild) ?? available[0]
    return <div className="personal-entry">
      {available.length > 1 && <nav className="personal-child-picker" aria-label="Выбрать ребёнка">{available.map((item) => <Button key={`${item.familyId}/${item.childId}`} type="button" variant={item === child ? 'default' : 'outline'} onClick={() => setSelectedChild(`${item.familyId}/${item.childId}`)}>{item.displayName}</Button>)}</nav>}
      {child?.dashboardToken ? <DayDashboard key={child.dashboardToken} token={child.dashboardToken} parent={child.role === 'parent'} />
        : <Card><CardContent className="py-8">Dashboard для этого профиля ещё не опубликован.</CardContent></Card>}
      <details className="personal-install-hint"><summary>Личная ссылка для установки на iPhone</summary>
        <p>Скопируйте именно ссылку профиля перед добавлением сайта на экран «Домой». При первом запуске с иконки нажмите «Войти по ссылке из буфера».</p>
        <Button type="button" variant="outline" onClick={() => void copyPersonalLink()}>{copied ? <Check /> : <Copy />}{copied ? 'Ссылка скопирована' : 'Скопировать личную ссылку'}</Button>
      </details>
      {error && <p role="alert" className="personal-login-error">{error}</p>}
    </div>
  }

  return <Card className="personal-login mx-auto max-w-2xl">
    <CardHeader>
      <div className="personal-entry-icon"><KeyRound /></div>
      <CardTitle>Войти в Education</CardTitle>
      <CardDescription>Скопируйте личную ссылку профиля и нажмите кнопку. Это нужно один раз после установки приложения на телефон.</CardDescription>
    </CardHeader>
    <CardContent>
      <Button type="button" className="personal-clipboard-button" disabled={busy} onClick={() => void openFromClipboard()}><ClipboardPaste />{busy ? 'Открываем…' : 'Войти по ссылке из буфера'}</Button>
      <button type="button" className="personal-manual-toggle" onClick={() => { if (manualEntry) setManualEntry(false); else showNativePaste() }} aria-expanded={manualEntry}>{manualEntry ? 'Скрыть ручной ввод' : 'Вставить вручную'}</button>
      {manualEntry && <form onSubmit={submit} className="personal-login-form">
        <Input ref={manualInput} aria-label="Личная ссылка Education" autoComplete="off" placeholder="https://…/#/enter/…" value={link} onPaste={pasteLink} onChange={(event) => { setLink(event.target.value); setError('') }} />
        <Button type="submit" disabled={busy || !link.trim()}>{busy ? 'Открываем…' : 'Войти'}</Button>
      </form>}
      {busy && !link && <p className="text-muted-foreground">Проверяем доступ…</p>}
      {!online && <p role="status" className="personal-offline">Нет сети. Приложение открылось, но личный план загрузится после подключения.</p>}
      {error && <p role="alert" className="personal-login-error">{error}</p>}
    </CardContent>
  </Card>
}
