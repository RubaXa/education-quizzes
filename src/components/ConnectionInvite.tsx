import { useEffect, useState } from 'react'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { Copy, Link2 } from 'lucide-react'
import StatusIcon from './StatusIcon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/firebase'
import { reportUiError } from '@/lib/uiErrors'

/** @see ../../docs/architecture/school-diary-port-adapter.md#family-onboarding-research
 * @see ../../docs/product/status-presentation.md#components */
export function ConnectionInvite({ code }: { code: string }) {
  const [state, setState] = useState<'loading' | 'open' | 'submitted' | 'connected' | 'closed' | 'error'>('loading')
  const [submitted, setSubmitted] = useState(false)
  const [copied, setCopied] = useState(false)
  const validCode = /^[A-Za-z0-9_-]{43}$/.test(code)
  const command = `npx education-connect --invite ${code}`

  useEffect(() => {
    if (!validCode) return
    let stopped = false
    let stopInvite: (() => void) | undefined
    let stopHandoff: (() => void) | undefined
    const watch = async () => {
      const auth = getAuth()
      await auth.authStateReady()
      if (!auth.currentUser) await signInAnonymously(auth)
      if (stopped) return
      stopInvite = onSnapshot(doc(db, 'connectionInvites', code), (snapshot) => {
        const data = snapshot.data()
        if (!snapshot.exists() || data?.status === 'rejected' || data?.status === 'revoked' || data?.expiresAt?.toMillis?.() <= Date.now()) setState('closed')
        else if (data?.status === 'connected') setState('connected')
        else setState((current) => current === 'submitted' ? current : 'open')
      }, (cause) => { reportUiError(cause, 'Приглашение'); setState('error') })
      stopHandoff = onSnapshot(doc(db, 'connectionInvites', code, 'handoff', 'current'), (snapshot) => {
        setSubmitted(snapshot.exists())
      }, (cause) => { reportUiError(cause, 'Приглашение'); setState('error') })
    }
    void watch().catch((cause) => { reportUiError(cause, 'Приглашение'); setState('error') })
    return () => { stopped = true; stopInvite?.(); stopHandoff?.() }
  }, [code, validCode])

  const display = !validCode ? 'closed' : state === 'open' && submitted ? 'submitted' : state
  const copy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
  }
  return <Card className="mx-auto max-w-2xl">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Link2 aria-hidden="true" /> Подключение учебных данных</CardTitle>
      <CardDescription>Вход в МЭШ выполняется на вашем компьютере. Пароль и код из SMS не вводятся на этом сайте.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      {display === 'loading' && <p><StatusIcon status="processing" /> Проверяем приглашение…</p>}
      {display === 'error' && <p role="alert"><StatusIcon status="failed" /> Не удалось проверить приглашение. Повторите попытку позже.</p>}
      {display === 'closed' && <p><StatusIcon status="paused" /> Приглашение закрыто или срок его действия истёк. Попросите новую ссылку.</p>}
      {display === 'connected' && <p><StatusIcon status="complete" /> МЭШ подключён. Взрослому будет выдана отдельная личная ссылка Education.</p>}
      {display === 'submitted' && <p><StatusIcon status="waiting" /> Доступ передан в зашифрованном виде. Ожидаем проверки оператором Education.</p>}
      {display === 'open' && <>
        <div className="space-y-2"><p><strong>1.</strong> Откройте Терминал или PowerShell на своём компьютере с Node.js 20 или новее.</p>
          <p><strong>2.</strong> Выполните команду:</p>
          <code className="block overflow-x-auto rounded-xl bg-slate-100 p-4 text-sm">{command}</code>
          <Button type="button" variant="outline" onClick={() => { void copy() }}><Copy aria-hidden="true" /> {copied ? 'Скопировано' : 'Скопировать команду'}</Button>
          <p><strong>3.</strong> Введите данные mos.ru и SMS в терминале, проверьте список детей и подтвердите передачу доступа.</p>
        </div>
        <p className="text-sm text-muted-foreground">Оператор получит возможность повторно читать доступные вам учебные данные МЭШ, пока подключение действует. Передаваемый пакет зашифрован для оператора.</p>
      </>}
    </CardContent>
  </Card>
}
