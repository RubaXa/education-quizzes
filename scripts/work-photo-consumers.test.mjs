/** @see ../docs/product/ui-change-control.md#photo-interactions */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('own photo consumers keep the shared interaction', () => {
  it.each([['src/DayPage.tsx', 'WorkPhotoGallery'], ['src/WeekendMathSlot.tsx', 'TaskWorkEvidence'], ['src/UiKit.tsx', 'WorkPhotoGallery']])('%s uses the shared interaction rather than a static thumbnail copy', (file, component) => {
    const source = readFileSync(file, 'utf8')
    expect(source).toContain(`import ${component} from '@/components/${component}'`)
    expect(source).toContain(`<${component} `)
    if (component === 'TaskWorkEvidence') expect(source).toContain('layout="weekend"')
    if (file === 'src/DayPage.tsx') expect(source).toContain('<TaskWorkEvidence layout="day"')
    expect(source).not.toMatch(/import .*\b(?:ArtifactAvatar|WorkArtifactImage)\b.*from ['"].*ArtifactAvatar/)
    expect(source).not.toContain('className="weekend-math-photo-item"')
  })
})
