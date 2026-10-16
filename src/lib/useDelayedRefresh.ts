import { useEffect, useState } from 'react'

/** Keep fast background refreshes invisible; only prolonged reconciliation gets a small icon.
 * @see ../../docs/modules/school-diary/dashboard.md#dashboard-warm-start */
export function useDelayedRefresh(active: boolean, delayMs = 450): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(false)
    if (!active) return
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [active, delayMs])
  return active && visible
}
