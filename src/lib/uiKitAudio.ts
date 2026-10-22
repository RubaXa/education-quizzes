import type { DayMaterialLink } from './dayStore'

/** Synthetic WAV, generated locally on intent. No copyrighted or family media.
 * @see ../../docs/shared/design/ui-kit.md */
export const uiKitAudioLink: DayMaterialLink = { title: 'Условная запись · короткий звук',
  url: 'https://disk.yandex.ru/d/ui-kit-audio-example', sourceType: 'audio', sourceRef: 'audio:ui-kit-example' }

export async function uiKitAudioResolver() {
  const rate = 8000, count = rate * 2
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, index) => bytes[offset + index] = char.charCodeAt(0))
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / rate) * 2500 * Math.min(1, i / 100, (count - i) / 100), true)
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`
}
