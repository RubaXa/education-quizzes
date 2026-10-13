import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react'
import { publicImage } from '@/lib/yandexPublic'
import './EducationImage.css'

export type ImageCrop = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number }
type ImageResolver = (source: string, size: string, refresh: boolean) => Promise<string>
type EducationImageProps = {
  source: string
  alt: string
  mode?: 'direct' | 'public'
  size?: string
  resolver?: ImageResolver
  revokeResolvedUrl?: boolean
  crop?: ImageCrop
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  aspectRatio?: CSSProperties['aspectRatio']
  fit?: CSSProperties['objectFit']
  className?: string
  compact?: boolean
  /** Set false only inside another button; its expanded viewer must offer retry. */
  retryControl?: boolean
  loading?: 'eager' | 'lazy'
}

function ImageRequest({ source, alt, mode = 'direct', size = 'XXXL', resolver, revokeResolvedUrl = false, crop, width, height, aspectRatio, fit = 'contain', className = '', compact = false, retryControl = true, loading = 'eager' }: EducationImageProps) {
  const [attempt, setAttempt] = useState(0)
  const [resolved, setResolved] = useState(mode === 'direct' && !resolver ? source : '')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const autoFailures = useRef(0)
  const retryTimer = useRef<number | null>(null)

  useEffect(() => () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current) }, [])

  const retry = useCallback((manual = true) => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    retryTimer.current = null
    if (manual) autoFailures.current = 0
    setStatus('loading')
    setResolved('')
    setAttempt((value) => value + 1)
  }, [])
  const fail = useCallback((transient: boolean) => {
    if (transient && autoFailures.current < 2) {
      const pause = Math.round(700 * 2 ** autoFailures.current * (0.5 + Math.random() / 2))
      autoFailures.current += 1
      setResolved('')
      retryTimer.current = window.setTimeout(() => retry(false), pause)
    } else setStatus('error')
  }, [retry])

  useEffect(() => {
    let active = true
    let objectUrl = ''
    const load = resolver ?? (mode === 'public' ? publicImage : async (value: string) => value)
    void load(source, size, attempt > 0).then((url) => {
      if (!url) { if (active) fail(false); return }
      if (active) { if (revokeResolvedUrl) objectUrl = url; setResolved(url) }
      else if (revokeResolvedUrl) URL.revokeObjectURL(url)
    }).catch(() => {
      // fetchWithRetry already handled transient API failures. Show retry now.
      if (active) fail(false)
    })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [source, mode, size, resolver, revokeResolvedUrl, attempt, fail])

  useEffect(() => {
    if (!resolved || status !== 'loading') return
    const timer = window.setTimeout(() => fail(false), 20_000)
    return () => window.clearTimeout(timer)
  }, [resolved, status, fail])

  useEffect(() => {
    if (status !== 'loading' || resolved) return
    const timer = window.setTimeout(() => fail(false), 35_000)
    return () => window.clearTimeout(timer)
  }, [resolved, status, attempt, fail])

  const cropValid = crop && crop.width > 0 && crop.height > 0 && crop.sourceWidth >= crop.x + crop.width && crop.sourceHeight >= crop.y + crop.height
  const style = {
    width, height,
    aspectRatio: cropValid ? `${crop.width} / ${crop.height}` : aspectRatio,
    '--edu-image-fit': fit,
    ...(cropValid ? {
      '--edu-crop-width': `${crop.sourceWidth / crop.width * 100}%`,
      '--edu-crop-left': `${-crop.x / crop.width * 100}%`,
      '--edu-crop-top': `${-crop.y / crop.height * 100}%`,
    } : {}),
  } as CSSProperties

  return <span className={`education-image${cropValid ? ' education-image-crop' : ''}${compact ? ' education-image-compact' : ''} ${className}`} data-state={status} style={style}>
    {resolved && status !== 'error' && <img key={`${resolved}:${attempt}`} src={resolved} alt={alt} loading={loading} referrerPolicy="no-referrer" ref={(node) => { if (node?.complete && node.naturalWidth > 0) { autoFailures.current = 0; setStatus('ready') } }} onLoad={() => { autoFailures.current = 0; setStatus('ready') }} onError={() => fail(mode === 'public' || Boolean(resolver))} />}
    {status === 'loading' && <span className="education-image-status" role="status"><LoaderCircle size={compact ? 16 : 25} aria-hidden="true" /><span className={compact ? 'education-image-sr-only' : ''}>Загружаем изображение…</span></span>}
    {status === 'error' && <span className="education-image-status education-image-error" role="alert"><CircleAlert size={compact ? 16 : 22} aria-hidden="true" /><span className={compact ? 'education-image-sr-only' : ''}>Не удалось загрузить изображение.</span>{retryControl && <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); retry() }} aria-label={compact ? 'Повторить загрузку изображения' : undefined}><RotateCcw size={compact ? 13 : 16} aria-hidden="true" />{!compact && 'Повторить'}</button>}</span>}
  </span>
}

/** One loading and retry contract for original pages, crops, photos and illustrations.
 * @see ../../docs/product/design-system.md#images */
export default function EducationImage(props: EducationImageProps) {
  return <ImageRequest key={`${props.mode ?? 'direct'}:${props.source}:${props.size ?? 'XXXL'}:${JSON.stringify(props.crop ?? null)}`} {...props} />
}
