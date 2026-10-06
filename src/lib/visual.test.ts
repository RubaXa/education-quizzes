import { describe, expect, it } from 'vitest'
import { resolveVisual } from './visual'

describe('subject artwork', () => {
  it('chooses a readable preset from the subject', () => {
    expect(resolveVisual('Иностранный язык (английский)').preset).toBe('english')
    expect(resolveVisual('Биология').scene).toBe('nature')
    expect(resolveVisual('Литература').scene).toBe('story')
    expect(resolveVisual('География').scene).toBe('atlas')
    expect(resolveVisual('Русский язык').preset).toBe('russian')
  })

  it('lets a topic choose its own scene without changing the subject preset', () => {
    expect(resolveVisual('Иностранный язык', { scene: 'city', caption: 'Петербург' })).toEqual({
      preset: 'english',
      scene: 'city',
      eyebrow: 'Языковая экспедиция',
      caption: 'Петербург',
    })
  })
})
