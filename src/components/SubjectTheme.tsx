import type { ReactNode } from 'react'
import { BookOpen, Compass, MapPin, Sparkles } from 'lucide-react'
import type { QuizReading, QuizVisual } from '@/lib/quiz'
import { resolveVisual } from '@/lib/visual'
import type { Scene } from '@/lib/visual'

function SceneArt({ scene }: { scene: Scene }) {
  if (scene === 'city') return (
    <svg className="scene-art scene-art-city" viewBox="0 0 440 290" aria-hidden="true">
      <circle cx="341" cy="68" r="42" fill="var(--art-sun)" />
      <path d="M0 220h440v70H0z" fill="var(--art-water)" />
      <path className="art-wave" d="M0 241q55-13 110 0t110 0 110 0 110 0M0 263q55-13 110 0t110 0 110 0 110 0" fill="none" stroke="var(--art-wave)" strokeWidth="3" />
      <path d="M28 215V125h57v90M89 215V94h57v121M155 215v-94h52v94M224 215V95h58v120M296 215v-80h48v80M358 215V108h55v107" fill="var(--art-buildings)" />
      <path d="M229 96q21-50 47 0M229 95h47M251 45v-14M237 57h28" fill="var(--art-dome)" stroke="var(--art-dome)" strokeWidth="4" />
      <path d="M28 151h57M89 122h57M155 146h52M296 160h48M358 136h55" stroke="var(--art-window)" strokeWidth="6" strokeDasharray="7 9" />
      <path d="M98 216q98-80 244 0" fill="none" stroke="var(--art-bridge)" strokeWidth="11" strokeLinecap="round" />
      <path d="M140 216v-45M196 216v-69M252 216v-68M309 216v-43" stroke="var(--art-bridge)" strokeWidth="7" />
      <g className="art-boat"><path d="M142 252h86l-18 14h-51z" fill="var(--art-boat)" /><path d="M176 251v-31l31 27z" fill="var(--art-sail)" /></g>
      <path d="M69 51q12-10 24 0 12-10 24 0M143 34q10-8 20 0 10-8 20 0" fill="none" stroke="var(--art-birds)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg className={`scene-art scene-art-${scene}`} viewBox="0 0 440 290" aria-hidden="true">
      <circle cx="219" cy="140" r="112" fill="var(--art-orb)" />
      {scene === 'code' && <><rect x="70" y="70" width="300" height="174" rx="20" fill="var(--art-panel)" /><circle cx="98" cy="94" r="6" fill="var(--art-accent)" /><circle cx="120" cy="94" r="6" fill="var(--art-accent)" /><path d="m165 153-28 22 28 22m108-44 28 22-28 22m-22-55-24 77" fill="none" stroke="var(--art-ink)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" /></>}
      {scene === 'nature' && <><path d="M205 260q-5-128 100-184M212 209q-77-19-74-95 67 0 74 95Zm38-63q-9-62 59-82 13 54-59 82Z" fill="var(--art-accent)" stroke="var(--art-ink)" strokeWidth="5" /><circle cx="107" cy="72" r="14" fill="var(--art-ink)" /><circle cx="331" cy="204" r="18" fill="var(--art-ink)" /></>}
      {scene === 'story' && <><path d="M220 98q-68-38-139 3v130q69-40 139 0 70-40 139 0V101q-70-41-139-3Z" fill="var(--art-panel)" stroke="var(--art-ink)" strokeWidth="7" /><path d="M220 98v133M110 133q39-16 81 1M250 134q40-17 79 0M110 169q39-16 81 1M250 170q40-17 79 0" stroke="var(--art-accent)" strokeWidth="7" fill="none" strokeLinecap="round" /><path d="M291 47q50-32 42 34-16 34-59 44 24-42 17-78Z" fill="var(--art-accent)" /></>}
      {scene === 'archive' && <><path d="M75 117 220 50l145 67H75Zm20 120h250v16H95zM112 128h25v101h-25zm63 0h25v101h-25zm65 0h25v101h-25zm63 0h25v101h-25z" fill="var(--art-panel)" stroke="var(--art-ink)" strokeWidth="5" /><circle cx="220" cy="97" r="14" fill="var(--art-accent)" /></>}
      {scene === 'shapes' && <><circle cx="220" cy="143" r="96" fill="none" stroke="var(--art-ink)" strokeWidth="8" /><path d="M220 53 337 226H103L220 53Z" fill="none" stroke="var(--art-accent)" strokeWidth="12" strokeLinejoin="round" /><circle cx="220" cy="143" r="21" fill="var(--art-panel)" /><circle cx="103" cy="226" r="12" fill="var(--art-ink)" /><circle cx="337" cy="226" r="12" fill="var(--art-ink)" /></>}
      {scene === 'language' && <><circle cx="221" cy="143" r="92" fill="none" stroke="var(--art-ink)" strokeWidth="9" /><path d="M128 143h185M220 52q-55 93 0 183M220 52q55 93 0 183M220 52v183" fill="none" stroke="var(--art-accent)" strokeWidth="7" /><path d="M52 61h89v48H97l-23 22v-22H52zM301 190h89v48h-34l-23 20v-20h-32z" fill="var(--art-panel)" /></>}
      {scene === 'atlas' && <><path d="m61 97 107-35 109 34 102-34v158l-102 34-109-34-107 34V97Z" fill="var(--art-panel)" stroke="var(--art-ink)" strokeWidth="7" strokeLinejoin="round" /><path d="M168 63v157M277 96v157M112 150q42-57 101 9t119-11" fill="none" stroke="var(--art-accent)" strokeWidth="8" strokeDasharray="10 10" /><path d="M281 84c0-29 47-29 47 0 0 25-23 45-23 45s-24-20-24-45Z" fill="var(--art-ink)" /><circle cx="305" cy="84" r="8" fill="var(--art-panel)" /></>}
      {scene === 'lab' && <><path d="M174 46h94M189 46v71l-65 104q-11 22 16 22h159q27 0 16-22l-66-104V46M155 189h129" fill="none" stroke="var(--art-ink)" strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" /><path d="M155 190h129l28 42H128z" fill="var(--art-accent)" /><circle cx="213" cy="211" r="11" fill="var(--art-panel)" /><circle cx="253" cy="225" r="7" fill="var(--art-panel)" /><circle cx="100" cy="111" r="16" fill="var(--art-accent)" /><circle cx="334" cy="78" r="12" fill="var(--art-ink)" /></>}
    </svg>
  )
}

export function ThemeFrame({ subject, visual, children }: { subject: string; visual?: QuizVisual | null; children: ReactNode }) {
  const { preset, scene } = resolveVisual(subject, visual)
  return <div className="theme-frame" data-preset={preset} data-scene={scene}>{children}</div>
}

export function ThemeHero({ subject, visual, title, description, preview = false, children }: {
  subject: string
  visual?: QuizVisual | null
  title: string
  description?: string
  preview?: boolean
  children?: ReactNode
}) {
  const resolved = resolveVisual(subject, visual)
  return (
    <section className="intro-card themed-hero">
      <div className="hero-copy">
        <div className="hero-topline"><span className="hero-kicker"><Sparkles size={15} />{resolved.eyebrow}</span>{preview && <span className="hero-preview">Предпросмотр · только чтение</span>}</div>
        <span className="subject-chip"><Compass size={15} />{subject}</span>
        <h1>{title}</h1>
        {description && <p className="hero-description">{description}</p>}
        <div className="hero-caption"><MapPin size={17} />{resolved.caption}</div>
        {children && <div className="hero-meta">{children}</div>}
      </div>
      <div className="hero-art-wrap"><SceneArt scene={resolved.scene} /></div>
    </section>
  )
}

export function ReadingCard({ reading }: { reading?: QuizReading | null }) {
  if (!reading) return null
  return (
    <section className="reading-card" aria-labelledby="reading-heading">
      <div className="reading-heading"><BookOpen size={20} /><div><span>Текст для заданий</span><h2 id="reading-heading">{reading.heading}</h2></div></div>
      <div className="reading-body">{reading.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </section>
  )
}
