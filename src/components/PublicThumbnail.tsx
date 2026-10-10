import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { publicImage } from '@/lib/yandexPublic'

/**
 * Повторяет получение адреса и загрузку миниатюры после временного сбоя Диска.
 * @see ../../docs/product/materials.md#material-reader
 * @see ../../docs/product/day-page.md#photo-preview
 */
export default function PublicThumbnail({ url, alt, fallback, size = 'S' }: { url: string; alt: string; fallback: ReactNode; size?: 'S' | 'XXXL' }) {
  const [image, setImage] = useState({ url, src: '' })
  const retry = useRef<() => void>(() => {})

  useEffect(() => {
    let active = true
    let attempts = 0
    let timer: number | undefined
    let waiting = false
    let exhausted = false

    function scheduleRetry() {
      if (!active || waiting) return
      setImage({ url, src: '' })
      if (attempts >= 3) { exhausted = true; return }
      waiting = true
      timer = window.setTimeout(() => { waiting = false; load() }, attempts * 500)
    }

    function load() {
      attempts += 1
      void publicImage(url, size, attempts > 1)
        .then((src) => { if (active) setImage({ url, src }) })
        .catch(scheduleRetry)
    }

    function retryAfterReconnect() {
      if (!active || !exhausted) return
      attempts = 0
      exhausted = false
      load()
    }

    function retryWhenVisible() { if (!document.hidden) retryAfterReconnect() }

    retry.current = scheduleRetry
    window.addEventListener('online', retryAfterReconnect)
    document.addEventListener('visibilitychange', retryWhenVisible)
    load()
    return () => {
      active = false
      window.clearTimeout(timer)
      window.removeEventListener('online', retryAfterReconnect)
      document.removeEventListener('visibilitychange', retryWhenVisible)
      retry.current = () => {}
    }
  }, [url, size])

  return image.url === url && image.src
    ? <img src={image.src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => retry.current()} />
    : fallback
}
