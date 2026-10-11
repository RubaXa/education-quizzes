import { useEffect, useState } from 'react'
import { CircleAlert, X } from 'lucide-react'
import { subscribeUiErrors } from '@/lib/uiErrors'
import './ErrorToasts.css'

type Toast = { id: number; message: string }

/** Short action failures; durable homework and product events live in the bell.
 * @see ../../docs/product/design-system.md#error-feedback */
export default function ErrorToasts() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => subscribeUiErrors((item) => setItems((current) => [...current, item].slice(-3))), [])
  useEffect(() => {
    if (!items.length) return
    const timers = items.map((item) => window.setTimeout(() => setItems((current) => current.filter((entry) => entry.id !== item.id)), 8000))
    return () => timers.forEach(window.clearTimeout)
  }, [items])
  return <div className="education-error-toasts" aria-live="assertive" aria-relevant="additions">
    {items.map((item) => <div className="education-error-toast" role="alert" key={item.id}>
      <CircleAlert size={19} aria-hidden="true" />
      <span>{item.message}</span>
      <button type="button" aria-label="Закрыть сообщение об ошибке" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><X size={17} /></button>
    </div>)}
  </div>
}
