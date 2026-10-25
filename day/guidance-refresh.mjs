import { isDeepStrictEqual } from 'node:util'
import { formatReviewProse } from '../src/lib/reviewProse.ts'
import { sourcePlanFingerprint } from './pipeline-contract.mjs'
/** @see ../docs/decisions/guidance-refresh-readback-2026-10-25.md */

/** Content is authored by the reviewer. This only fences a revision-only update.
 * @see ../docs/modules/synchronization/task-routing.md#guidance-refresh */
export function refreshGuides(source, updates) {
  const next = structuredClone(source)
  const problems = next.subjects.flatMap(s => ['math', 'special'].includes(s.id)
    ? s.tasks.flatMap(t => t.problems ?? []) : [])
  const seen = new Set()
  for (const update of updates) {
    const p = problems.find(p => p.id === update.taskId)
    if (!p?.parentGuide || seen.has(p.id)) throw new Error('missing_or_duplicate_guide')
    seen.add(p.id)
    const guide = p.parentGuide
    if (!Array.isArray(update.stages) || update.stages.length !== guide.stages.length
      || update.stages.some((stage, i) => stage.id !== guide.stages[i].id)) throw new Error('stage_identity_changed')
    for (const [i, authored] of update.stages.entries()) {
      const change = { ...authored }
      if (change.hint) { change.hintPreview=change.hint;delete change.hint }
      if (change.explanation) {
        const prose=formatReviewProse(change.explanation)
        const sentences=[...new Intl.Segmenter('ru',{granularity:'sentence'}).segment(prose)].map(s=>s.segment.trim()).filter(Boolean)
        change.expected=sentences.shift()
        change.rows=sentences.length?sentences.map(value=>({value})):[{value:'Подробное раскрытие этого шага доступно ниже.'}]
        change.revealPreview=prose
        delete change.explanation
      }
      for(const key of ['expected','hintPreview','revealPreview']) if(typeof change[key]==='string')change[key]=formatReviewProse(change[key])
      if(change.rows)change.rows=change.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'?formatReviewProse(v):v])))
      const merged = { ...guide.stages[i], ...change }
      if (Object.keys(change).some(k => !['id', 'expected', 'rows', 'hintPreview', 'revealPreview', 'verification'].includes(k))
        || !['expected', 'hintPreview', 'revealPreview'].every(k => typeof merged[k] === 'string' && merged[k].trim())
        || !Array.isArray(merged.rows) || !merged.rows.length) throw new Error('invalid_authored_stage')
      Object.assign(guide.stages[i], change)
    }
    for(const stage of guide.stages) {
      for(const key of ['title','expected','hintPreview','revealPreview','answer'])if(typeof stage[key]==='string')stage[key]=formatReviewProse(stage[key])
      for(const key of ['rows','verification'])if(Array.isArray(stage[key]))stage[key]=stage[key].map(row=>typeof row==='string'?formatReviewProse(row)
        :Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'?formatReviewProse(v):v])))
    }
    guide.revision++
    if (typeof update.firstQuestion !== 'string' || !update.firstQuestion.trim()) throw new Error('missing_next_question')
    p.support = { ...p.support, firstQuestion: formatReviewProse(update.firstQuestion), revision: p.support.revision + 1 }
    if (update.supportEvidence) p.support.evidence=formatReviewProse(update.supportEvidence)
    if (update.supportState) {
      if(!['unknown','provisional'].includes(update.supportState))throw new Error('unsupported_mastery_change')
      p.support.state=update.supportState
    }
  }
  if (seen.size !== problems.filter(p => p.parentGuide).length) throw new Error('incomplete_day_scope')
  return next
}

export const guidancePolicyRevision='parent-readable-hints-2026-10-25'
export function assertPolicyChecks(plan, updates) {
  const ids=updates.map(u=>u.taskId).sort()
  if(plan.policyRevision!==guidancePolicyRevision||plan.checks?.policyRevision!==guidancePolicyRevision)throw new Error('guidance_policy_review_stale')
  for(const key of ['adultReadability','targetedHint']) {
    const check=plan.checks[key]
    if(check?.confirmed!==true||typeof check.basis!=='string'||check.basis.trim().length<30
      ||!isDeepStrictEqual([...(check.reviewedTaskIds??updates.filter(u=>u[key==='adultReadability'?'adultReviewed':'hintReviewed']===true).map(u=>u.taskId))].sort(),ids))throw new Error(`missing_operator_review:${key}`)
  }
}

/** Exclude only fields this publisher is allowed to change. Everything else is fenced. */
export function preservedPage(page) {
  const copy = structuredClone(page)
  for (const key of ['updatedAt', 'problemSupportRevision', 'problemSupportChanges','sourcePlanFingerprint']) delete copy[key]
  for (const subject of copy.subjects ?? []) for (const task of subject.tasks ?? []) for (const p of task.problems ?? []) {
    delete p.support
  }
  return copy
}

export function assertRefreshPreflight(snapshot, live, source) {
  if (!isDeepStrictEqual(snapshot.owner, live.owner) || !isDeepStrictEqual(snapshot.evidence, live.evidence)) throw new Error('stale_owner_or_evidence')
  const targets = source.subjects.flatMap(s=>['math','special'].includes(s.id)?s.tasks.flatMap(t=>t.problems??[]):[]).filter(p=>p.parentGuide)
  for (const [i,page] of live.pages.entries()) {
    if(![snapshot.pages[i].sourcePlanFingerprint,sourcePlanFingerprint(source)].includes(page.sourcePlanFingerprint))throw new Error('stale_live_fingerprint')
    if (!isDeepStrictEqual(preservedPage(page),preservedPage(snapshot.pages[i]))) throw new Error('stale_live_page')
    for (const p of targets) {
      const old=snapshot.pages[i].subjects.flatMap(s=>s.tasks.flatMap(t=>t.problems??[])).find(q=>q.id===p.id)
      const current=page.subjects.flatMap(s=>s.tasks.flatMap(t=>t.problems??[])).find(q=>q.id===p.id)
      if (!isDeepStrictEqual(old?.original,p.original)) throw new Error('local_original_differs_from_live_source')
      if (!isDeepStrictEqual(current?.support,old?.support)&&!isDeepStrictEqual(current?.support,p.support)) throw new Error('stale_live_support')
    }
  }
  for(const [id,guide] of Object.entries(live.guides)) {
    const p=targets.find(p=>p.id===id),old=snapshot.guides[id]
    const comparable={...guide},allowed=p?{...old,guide:p.parentGuide,sourcePlanFingerprint:sourcePlanFingerprint(source)}:null
    delete comparable.updatedAt
    if(allowed)delete allowed.updatedAt
    if (!isDeepStrictEqual(guide,old)&&!(allowed&&isDeepStrictEqual(comparable,allowed))) throw new Error('stale_live_guide')
  }
}

export function assertRefreshReadback({ beforePages, afterPages, source, guides, beforeEvidence, afterEvidence }) {
  if (!isDeepStrictEqual(beforeEvidence, afterEvidence)) throw new Error('learning_evidence_changed_during_refresh')
  if (afterPages.length !== 2 || beforePages.length !== 2) throw new Error('two_roles_required')
  for (const [i, page] of afterPages.entries()) {
    if(page.sourcePlanFingerprint!==sourcePlanFingerprint(source))throw new Error('publication_fingerprint_stale')
    if (!isDeepStrictEqual(preservedPage(page), preservedPage(beforePages[i]))) throw new Error('unrelated_page_fields_changed')
    for (const s of page.subjects ?? []) for (const t of s.tasks ?? []) for (const p of t.problems ?? []) {
      if (p.parentGuide || p.sourceResearch) throw new Error('private_guide_in_public_page')
    }
  }
  const expected = source.subjects.flatMap(s => ['math','special'].includes(s.id) ? s.tasks.flatMap(t => t.problems ?? []) : [])
    .filter(p => p.parentGuide)
  for (const p of expected) {
    if (!isDeepStrictEqual(guides[p.id]?.guide, p.parentGuide)) throw new Error(`guide_readback_mismatch:${p.id}`)
    for (const page of afterPages) {
      const live = page.subjects.flatMap(s => s.tasks.flatMap(t => t.problems ?? [])).find(q => q.id === p.id)
      if (!isDeepStrictEqual(live?.support, p.support) || !isDeepStrictEqual(live?.original, p.original)) throw new Error(`public_support_mismatch:${p.id}`)
    }
  }
  return expected.length
}
