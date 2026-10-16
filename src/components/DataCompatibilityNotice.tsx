import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { activateEducationUpdate } from '@/lib/pwa'
import './DataCompatibilityNotice.css'

/** A blocking state only for a future data schema this client cannot read.
 * @see ../../docs/modules/families/access-and-state.md#schema-compatibility */
export default function DataCompatibilityNotice() {
  const [error, setError] = useState('')
  async function update() {
    try {
      const registration = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL)
      await registration?.update()
      if (registration?.waiting) await activateEducationUpdate()
      else window.location.reload()
    } catch {
      setError('Обновление пока недоступно. Проверьте соединение и повторите попытку.')
    }
  }
  return <main className="data-compatibility" role="alert">
    <h1>Нужно обновить Education</h1>
    <p>Данные этого раздела записаны в новой версии. До обновления мы не показываем неполную карточку и не меняем результаты.</p>
    <button type="button" onClick={() => void update()}><RefreshCw size={18} aria-hidden="true" /> Обновить</button>
    {error && <p>{error}</p>}
  </main>
}
