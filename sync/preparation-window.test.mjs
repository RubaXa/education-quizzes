import { describe, expect, it } from 'vitest'
import { preparationExpiry } from './preparation-window.mjs'
/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
const window = ['2026-11-02', '2026-12-13']
describe('moving weekly preparation window', () => {
  it('archives last week, retaining Monday and the entire current week', () => {
    expect(preparationExpiry({kind:'enrich-task',source:{date:'2026-10-30'}},window)).toContain('active-from:2026-11-02')
    for (const date of ['2026-11-02','2026-11-03','2026-11-09']) expect(preparationExpiry({kind:'material-needed',source:{date}},window)).toBeNull()
  })
  it('never expires attempts, help, event actions or unknown source dates', () => {
    for (const kind of ['review-work','review-quiz','triage-help','repair-review','prepare-targeted-followup'])
      expect(preparationExpiry({kind,source:{date:'2026-10-20'}},window)).toBeNull()
    expect(preparationExpiry({kind:'enrich-task',artifactPath:'operatorSyncTaskArtifacts/id',source:{date:'2026-10-20'}},window)).toBeNull()
    expect(preparationExpiry({kind:'enrich-task',source:{}},window)).toBeNull()
  })
})
