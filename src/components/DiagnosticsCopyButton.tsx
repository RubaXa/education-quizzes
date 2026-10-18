/** @see ../../docs/modules/families/browser-access-trace.md */
import { useState } from 'react'
import { Button } from './ui/button'
import { copyAccessDiagnostics } from '@/lib/browserAccessTrace'

export function DiagnosticsCopyButton() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const copy = async () => {
    setBusy(true)
    try { await copyAccessDiagnostics(); setMessage('Логи скопированы') }
    catch { setMessage('Не удалось скопировать логи. Нажмите 🐞 ещё раз.') }
    finally { setBusy(false) }
  }
  return <>
    <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label="Скопировать логи диагностики" title={message || 'Скопировать логи диагностики'} disabled={busy} onClick={() => void copy()}><span aria-hidden="true">🐞</span></Button>
    <span className="sr-only" role="status">{message}</span>
  </>
}
