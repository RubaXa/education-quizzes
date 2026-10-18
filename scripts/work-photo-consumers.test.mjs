/** @see ../docs/product/ui-change-control.md#photo-interactions */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('own photo consumers keep the shared interaction', () => {
  it.each(['src/DayPage.tsx', 'src/WeekendMathSlot.tsx', 'src/UiKit.tsx'])('%s uses the gallery rather than a static thumbnail copy', (file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).toContain("import WorkPhotoGallery from '@/components/WorkPhotoGallery'")
    expect(source).toContain('<WorkPhotoGallery ')
    expect(source).not.toMatch(/import .*\b(?:ArtifactAvatar|WorkArtifactImage)\b.*from ['"].*ArtifactAvatar/)
    expect(source).not.toContain('className="weekend-math-photo-item"')
  })
})
