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
        <ol>
          <li>На личной странице нажмите «Скопировать личную ссылку» или скопируйте ссылку из сообщения.</li>
          <li>Откройте Education в Safari и нажмите «Поделиться».</li>
          <li>Выберите «На экран „Домой“» и «Добавить». Если появится переключатель «Открывать как приложение», оставьте его включённым.</li>
          <li>Откройте Education с иконки и вставьте скопированную ссылку один раз.</li>
        </ol>
        <p>Приложение сохранит вход на этом iPhone. Если его данные будут очищены, откройте личную ссылку снова.</p>
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

/** @see ../../docs/product/pwa.md#updates */
export function PwaConnectionNotice() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const reconnect = () => setOnline(true)
    const disconnect = () => setOnline(false)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnect)
    return () => {
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', disconnect)
    }
  }, [])
  if (online) return null
  return <div className="pwa-offline" role="status">Нет сети. Показанные данные могут устареть; новые изменения появятся после подключения.</div>
}
