import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, Headphones, LoaderCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DayMaterialLink } from '@/lib/dayStore'
import { publicAudio } from '@/lib/yandexPublic'
import './AudioPlayer.css'

const rates = [0.5, 0.75, 1, 1.25, 1.5]
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** One stable control panel for assignments, library and UI Kit, including WebKit.
 * @see ../../docs/modules/materials/audio-library.md#player */
export default function AudioPlayer({ link, resolver = publicAudio }: {
  link: DayMaterialLink; resolver?: (url: string, sha256?: string) => Promise<string>
}) {
  const labelId = useId()
  const audio = useRef<HTMLAudioElement>(null)
  const request = useRef(0)
  const object = useRef<string | undefined>(undefined)
  const settings = useRef({ speed: 1, volume: 1, muted: false })
  const [state, setState] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'error'; src?: string }>({ phase: 'idle' })
  const [duration, setDuration] = useState<number | null>(null)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    request.current += 1
    setState({ phase: 'idle' }); setDuration(null); setPosition(0); setPlaying(false)
    return () => { request.current += 1; release() }
  }, [link.url, link.sourceSha256])

  useEffect(() => {
    // Start only for the original Play intent, after React has installed src.
    if (state.phase === 'ready') void play()
  }, [state.phase, state.src])

  function release() {
    audio.current?.pause()
    if (object.current?.startsWith('blob:')) URL.revokeObjectURL(object.current)
    object.current = undefined
  }

  function applySettings() {
    if (!audio.current) return
    audio.current.defaultPlaybackRate = settings.current.speed
    audio.current.playbackRate = settings.current.speed
    audio.current.volume = settings.current.volume
    audio.current.muted = settings.current.muted
  }

  async function play() {
    if (!audio.current) return
    const generation = request.current
    applySettings()
    // If browser gesture policy rejects delayed play, the same Play stays available.
    await audio.current.play().catch(() => { if (request.current === generation) setPlaying(false) })
  }

  function readDuration() {
    const value = audio.current?.duration
    setDuration(state.phase === 'ready' && value !== undefined && Number.isFinite(value) && value > 0 ? value : null)
    applySettings()
  }

  async function prepare() {
    if (state.phase === 'loading') return
    const generation = ++request.current
    release()
    setState({ phase: 'loading' }); setDuration(null); setPosition(0); setPlaying(false)
    try {
      const src = await resolver(link.url, link.sourceSha256)
      if (request.current !== generation) { if (src.startsWith('blob:')) URL.revokeObjectURL(src); return }
      object.current = src
      setState({ phase: 'ready', src })
    } catch {
      if (request.current === generation) setState({ phase: 'error' })
    }
  }

  const time = duration === null ? '--:-- / --:--' : `${clock(position)} / ${clock(duration)}`
  return <section className="edu-audio" aria-labelledby={labelId}>
    <div className="edu-audio-heading"><Headphones size={18} aria-hidden="true" /><strong id={labelId}>{link.title}</strong></div>
    <audio ref={audio} hidden preload="none" src={state.src} aria-hidden="true"
      onLoadedMetadata={readDuration} onDurationChange={readDuration}
      onTimeUpdate={(event) => { if (Number.isFinite(event.currentTarget.currentTime)) setPosition(Math.max(0, event.currentTarget.currentTime)) }}
      onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onPlay={(event) => {
        setPlaying(true)
        document.querySelectorAll('audio').forEach((other) => { if (other !== event.currentTarget) other.pause() })
      }} onError={() => { if (object.current) { release(); setDuration(null); setPosition(0); setPlaying(false); setState({ phase: 'error' }) } }} />
    <div className="edu-audio-panel" role="group" aria-label="Управление записью" aria-busy={state.phase === 'loading'}>
      <div className="edu-audio-main-controls">
        <Button type="button" variant="ghost" className="edu-audio-play" aria-label={`${playing ? 'Пауза' : 'Воспроизвести'}: ${link.title}`}
          disabled={state.phase === 'loading' || state.phase === 'error'} onClick={() => {
            if (state.phase !== 'ready') void prepare()
            else if (playing) audio.current?.pause()
            else void play()
          }}>
          {state.phase === 'loading' ? <LoaderCircle size={18} aria-hidden="true" /> : playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </Button>
        <span className={`edu-audio-time${duration === null ? ' edu-audio-time-unknown' : ''}`} aria-label={duration === null ? 'Длительность записи пока неизвестна' : undefined}>{time}</span>
        <label className="edu-audio-speed"><span>Скорость</span><select aria-label="Скорость воспроизведения" value={speed} onChange={(event) => {
          const next = Number(event.target.value)
          if (!rates.includes(next)) return
          settings.current.speed = next; setSpeed(next); applySettings()
        }}>{rates.map(rate => <option key={rate} value={rate}>{String(rate).replace('.', ',')}×</option>)}</select></label>
      </div>
      <div className="edu-audio-adjustments">
        <input className="edu-audio-seek" type="range" aria-label="Позиция записи" min="0" max={duration ?? 1} step="0.1" value={duration === null ? 0 : Math.min(position, duration)}
          aria-valuetext={duration === null ? 'Длительность пока неизвестна' : time} disabled={duration === null || state.phase !== 'ready'} onChange={(event) => {
            if (!audio.current || duration === null) return
            const next = Math.min(duration, Math.max(0, Number(event.target.value)))
            audio.current.currentTime = next; setPosition(next)
          }} />
        <div className="edu-audio-volume">
          <Button type="button" variant="ghost" className="edu-audio-mute" aria-label={muted ? 'Включить звук' : 'Выключить звук'} aria-pressed={muted} onClick={() => {
            const next = !muted
            settings.current.muted = next; setMuted(next)
            if (!next && volume === 0) { settings.current.volume = 1; setVolume(1) }
            applySettings()
          }}>{muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}</Button>
          <input type="range" aria-label="Громкость" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => {
            const next = Number(event.target.value)
            settings.current.volume = next; settings.current.muted = next === 0
            setVolume(next); setMuted(next === 0); applySettings()
          }} />
        </div>
      </div>
    </div>
    {state.phase === 'loading' && <p role="status"><LoaderCircle size={16} aria-hidden="true" />Загружаем запись…</p>}
    {state.phase === 'error' && <><p role="alert">Не удалось загрузить запись. Попробуйте ещё раз или откройте её на Диске.</p><Button type="button" variant="outline" onClick={() => void prepare()}><RotateCcw size={16} aria-hidden="true" />Повторить</Button></>}
    <a className="edu-audio-original" href={link.url} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>
  </section>
}
