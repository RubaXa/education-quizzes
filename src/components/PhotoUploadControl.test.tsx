import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PhotoUploadControl from './PhotoUploadControl'

describe('shared photo upload control', () => {
  it('accepts several images for the next page or correction', () => {
    const html = renderToStaticMarkup(<PhotoUploadControl label="Добавить ещё фото" onPhotos={() => {}} />)
    expect(html).toContain('Добавить ещё фото')
    expect(html).toContain('type="file"')
    expect(html).toContain('accept="image/*"')
    expect(html).toContain('multiple=""')
  })
})
