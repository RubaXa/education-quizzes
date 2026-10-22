import { useState } from 'react'
import type { DayMaterialLink } from '@/lib/dayStore'
import AudioPlayer from './AudioPlayer'

/** A single selected track prevents hundreds of simultaneous media requests.
 * @see ../../docs/modules/materials/audio-library.md#player */
export default function AudioLibrary({ tracks }: { tracks: DayMaterialLink[] }) {
  const [selected, setSelected] = useState('')
  const link = tracks.find((track) => (track.sourceRef ?? track.url) === selected) ?? tracks[0]
  if (!link) return null
  return <div className="edu-audio-library"><label>Аудиозаписи · {tracks.length}
    <select value={link.sourceRef ?? link.url} onChange={(event) => setSelected(event.target.value)}>
      {(['sb', 'wb', 'test'] as const).map((kind) => <optgroup key={kind} label={kind === 'sb' ? 'Учебник' : kind === 'wb' ? 'Рабочая тетрадь' : 'Контрольные записи'}>
        {tracks.filter((track) => track.audioKind === kind).map((track) => <option key={track.sourceRef ?? track.url} value={track.sourceRef ?? track.url}>{track.title}</option>)}
      </optgroup>)}
    </select></label><AudioPlayer key={`${link.sourceRef}:${link.sourceSha256}`} link={link} /></div>
}
