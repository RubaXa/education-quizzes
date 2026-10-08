import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { activateEducationUpdate, registerEducationApp } from '@/lib/pwa'
import './PwaControls.css'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** @see ../../docs/product/pwa.md#install */
export function PwaInstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)')
    const update = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    const onInstalled = () => { setInstalled(true); setShowHelp(false) }
    update()
    standalone.addEventListener('change', update)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      standalone.removeEventListener('change', update)
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  if (installed) return null
  const install = async () => {
    if (prompt) { await prompt.prompt(); await prompt.userChoice; setPrompt(null) }
    else setShowHelp(true)
  }
  return <>
    <button className="pwa-install" type="button" onClick={() => void install()}><Download size={16} /> На экран телефона</button>
    {showHelp && <div className="pwa-help-backdrop" onClick={() => setShowHelp(false)}>
      <div className="pwa-help" role="dialog" aria-modal="true" aria-label="Как установить Education" onClick={(event) => event.stopPropagation()}>
        <button className="pwa-help-close" type="button" aria-label="Закрыть" onClick={() => setShowHelp(false)}><X size={20} /></button>
        <h2>Добавить Education на iPhone</h2>
        <ol><li>Откройте эту страницу в Safari.</li><li>Нажмите «Поделиться».</li><li>Выберите «На экран „Домой“», затем «Добавить».</li></ol>
        <p>После установки приложение откроется без панели браузера. Для личного стартового экрана понадобится вход в свой аккаунт Education.</p>
      </div>
    </div>}
  </>
}

/** @see ../../docs/product/pwa.md#updates */
export function PwaUpdateNotice() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => registerEducationApp(() => setReady(true)), [])
  if (!ready) return null
  return <div className="pwa-update" role="status">
    <span>Доступна новая версия Education. Сохраните текущую работу перед обновлением.</span>
    <button type="button" onClick={() => void activateEducationUpdate().catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось обновить приложение.'))}><RefreshCw size={16} /> Обновить</button>
    {error && <small>{error}</small>}
  </div>
}
