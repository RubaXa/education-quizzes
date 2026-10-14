import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import StatusIcon from './StatusIcon'
import type { EducationStatus } from './StatusIcon'

// @see ../../docs/product/status-presentation.md#matrix
const statuses: EducationStatus[] = [
  'ready', 'started', 'uploading', 'waiting', 'processing', 'paused', 'complete',
  'partial', 'needs-fix', 'incorrect', 'unknown', 'failed', 'new',
]

describe('common status vocabulary', () => {
  it.each(statuses)('renders %s as a decorative, consistently named Lucide icon', (status) => {
    const html = renderToStaticMarkup(<StatusIcon status={status} size={16} />)
    expect(html).toContain(`data-status="${status}"`)
    expect(html).toContain(`edu-status-icon-${status}`)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('width="16"')
  })
})
