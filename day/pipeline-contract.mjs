/** @see ../docs/decisions/mesh-informational-entry-2026-10-21.md */
/**
 * @see ../docs/modules/reviews/README.md
 * @see ../docs/modules/reviews/card-flow-certification.md
 * @see ../docs/decisions/family-essay-assignment-2026-10-20.md
 * @see ../docs/decisions/source-only-mesh-publication-2026-10-20.md
 */
import { createHash } from 'node:crypto'
import { lessonVisibility } from '../diary/application/lesson-visibility.mjs'
import { publicPageSubjects } from './public-projection.mjs'
import { assignmentRouteEvidence } from './assignment-routing.mjs'
import { subjectPresentation } from './subject-identity.mjs'
import { familyAssignmentErrors, familyAssignmentProjectionSignature, stableFamilyProjectionJson } from './family-assignment.mjs'
import { sourceOnlyPublicationErrors } from './source-only.mjs'
import { meshNoticeEntryErrors } from './mesh-notice.mjs'

/** Explain the failing field and canonical page IDs without weakening source checks.
 * @see ../docs/modules/synchronization/plan-generation.md#review-gate */
export function textbookRefError(ref, pageIds = [], { path = 'source.ref', exact = true } = {}) {
  if (typeof ref === 'string' && pageIds.some((pageId) => exact ? ref === pageId : ref.startsWith(pageId))) return null
  return `${path}: получено ${JSON.stringify(ref) ?? 'undefined'}; нужна назначенная страница ${pageIds.length ? pageIds.join(', ') : '(taskPages пуст — сначала свяжите семейную страницу)'}.${exact ? ' Используйте точный ID без суффикса.' : ''}`
}

/** @see ../docs/modules/synchronization/plan-generation.md#publication-preflight */
export function meshEntries(snapshot) {
  if (!snapshot?.complete || !Array.isArray(snapshot.assignments)
    || snapshot.assignments.some((item) => item.detailStatus !== 'loaded')) {
    throw new Error('Для публикации нужен полный снимок МЭШ с подробными карточками уроков.')
  }
  return lessonVisibility(snapshot.assignments).conducted.flatMap((assignment) => {
    const descriptions = assignment.homeworkEntries?.length
      ? assignment.homeworkEntries
      : (assignment.descriptions || []).map((description, index) => ({ id: `${assignment.sourceItemId}-${index}`, description }))
    const subjectName = assignment.subjectName ?? assignment.subject_name
    const [subjectId] = subjectPresentation(subjectName, assignment.subjectId)
    return descriptions.filter((entry) => typeof entry.description === 'string' && entry.description.trim())
      .map((entry) => ({ id: `mesh-${entry.id}`, text: entry.description.trim(), subjectId, subjectName,
        hasTeacherFiles: (assignment.teacherFiles?.length ?? 0) > 0 }))
  })
}

/** A source may explain an assignment, but cannot silently omit or rewrite it. */
export function assertSourceAligned(source, snapshot, routeContext = {}) {
  if (source.targetDate !== snapshot?.date) throw new Error('Дата урока в плане не совпадает со снимком МЭШ.')
  const expected = meshEntries(snapshot)
  const routed = assignmentRouteEvidence(source, routeContext.readSource, routeContext.readSnapshot)
  if (source.meshAlignment?.state === 'legacy-manual') {
    if (!source.meshAlignment.reason?.trim()) throw new Error('Для старого ручного плана нужна причина исключения из ID-сверки.')
    return { legacy: true, count: expected.length }
  }
  const tasks = source.subjects?.flatMap((subject) => subject.tasks ?? []) ?? []
  const represented = [...tasks.map((task) => ({ id: task.id, text: task.meshText?.trim() })),
    ...(source.sourceOnlyEntries ?? []).map((entry) => ({ id: entry.id, text: entry.rawText?.trim() })), ...routed.exports]
  const expectedById = new Map(expected.map((entry) => [entry.id, entry.text]))
  for (const entry of routed.imports) expectedById.set(entry.id, entry.text)
  for (const entry of expected) {
    if (!represented.some((item) => item.id === entry.id && item.text === entry.text)) {
      throw new Error(`План не содержит актуальную запись МЭШ ${entry.id}. Запустите day build и сверьте её до выпуска.`)
    }
  }
  for (const entry of source.sourceOnlyEntries ?? []) {
    const expectedEntry = expected.find((item) => item.id === entry.id)
    if (expectedById.get(entry.id) !== entry.rawText?.trim()
      || entry.kind === 'notice' && (!expectedEntry || expectedEntry.hasTeacherFiles
        || expectedEntry.subjectId !== entry.subjectId
        && source.subjects.find((item) => item.id === entry.subjectId)?.name !== expectedEntry.subjectName)) {
      throw new Error(`План содержит неподтверждённую запись ${entry.id}; сверьте точный текст МЭШ.`)
    }
    if (entry.kind === 'notice') {
      const subject = source.subjects.find((item) => item.id === entry.subjectId)
      const errors = meshNoticeEntryErrors(entry, { subject, tasks: subject?.tasks ?? [], hasTeacherFiles: expectedEntry?.hasTeacherFiles })
      if (errors.length) throw new Error(errors.join(' '))
    }
  }
  for (const task of tasks.filter((item) => item.id?.startsWith('mesh-') && item.meshText)) {
    if (expectedById.get(task.id) === task.meshText.trim()) continue
    const parentId = task.id.replace(/-cdz$/, '')
    if (parentId !== task.id && expectedById.get(parentId) === task.meshText.trim()) continue
    throw new Error(`План содержит устаревшее или неподтверждённое назначение ${task.id}. Сверьте изменение МЭШ.`)
  }
  return { legacy: false, count: expected.length }
}

/** Stable fingerprint of operator-authored plan fields, excluding live evidence. */
export function sourcePlanFingerprint(source) {
  const plan = {
    targetDate: source.targetDate, subjects: source.subjects, sourceOnlyEntries: source.sourceOnlyEntries ?? [],
    retiredTaskIds: source.retiredTaskIds ?? [], materialLinks: source.materialLinks ?? {},
    ...(source.assignmentRoutes?.length ? { assignmentRoutes: source.assignmentRoutes } : {}),
    testPlacements: source.testPlacements ?? [], weekendSlot: source.weekendSlot ?? null,
  }
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

function assertFamilyProjectionMatches(source, page, role, familyAssignments) {
  const expectedFamily = familyAssignments.filter((task) => task.dueDate === source.targetDate && task.publication === 'active' && task.sourceSystem === 'family' && task.dayProjectionVersion === 1)
  const familyErrors = expectedFamily.flatMap((task) => familyAssignmentErrors(task, { familyId: page.familyId, childId: page.childId, taskId: task.id }))
  const actualFamily = page.subjects.flatMap((subject) => subject.tasks ?? []).filter((task) => task.familyOrigin)
  const expectedIds = expectedFamily.map((task) => task.id).sort()
  const actualIds = actualFamily.map((task) => task.id).sort()
  const publicFields = new Set(['id', 'title', 'detail', 'kind', 'status', 'source', 'familyOrigin', 'steps', 'submission',
    'cardPattern', 'cardPolicyVersion', 'outputKind', 'lessonDate', 'dueDate'])
  const hasPrivateFields = actualFamily.some((task) => Object.keys(task).some((key) => !publicFields.has(key)))
  const invalidFamilyOrigin = actualFamily.some((task) => !task.familyOrigin || Object.keys(task.familyOrigin).some((key) => !['sourceSystem', 'sourceId', 'sourceRevision', 'projectedSourceRevision'].includes(key))
    || task.familyOrigin.sourceSystem !== 'family' || task.familyOrigin.projectedSourceRevision !== task.familyOrigin.sourceRevision)
  if (familyErrors.length || hasPrivateFields || invalidFamilyOrigin || JSON.stringify(expectedIds) !== JSON.stringify(actualIds)
    || expectedFamily.some((task) => {
      const expected = familyAssignmentProjectionSignature(task)
      const actual = actualFamily.find((item) => item.id === task.id)
      return stableFamilyProjectionJson(familyAssignmentProjectionSignature(actual ?? {})) !== stableFamilyProjectionJson(expected)
        || !page.taskIds?.includes(task.id)
    })) {
    throw new Error(`Опубликованная страница ${role} не совпадает с каноническими семейными заданиями на ${source.targetDate}.`)
  }
}

export function assertPublishedPageAligned(source, page, role, familyAssignments = []) {
  if (!page || page.kind !== role || page.targetDate !== source.targetDate) {
    throw new Error(`Опубликованная страница ${role} не соответствует дате урока ${source.targetDate}.`)
  }
  assertFamilyProjectionMatches(source, page, role, familyAssignments)
  if (JSON.stringify(page.sourceOnlyEntries ?? []) !== JSON.stringify(source.sourceOnlyEntries ?? [])) {
    throw new Error(`Опубликованная страница ${role} потеряла точное уведомление или ссылку МЭШ.`)
  }
  if (page.sourcePlanFingerprint) {
    if (page.sourcePlanFingerprint !== sourcePlanFingerprint(source)) {
      throw new Error(`Опубликованная страница ${role} отстаёт от локального плана урока ${source.targetDate}. Сначала day publish.`)
    }
    // A matching copied fingerprint alone cannot prove that nested tasks survived
    // projection, writing and readback. Check the user-visible topology too.
    for (const task of source.subjects?.flatMap((subject) => subject.tasks ?? []) ?? []) {
      if (task.sourceOnly !== true) continue
      const published = page.subjects?.flatMap((subject) => subject.tasks ?? []).find((item) => item.id === task.id)
      const errors = sourceOnlyPublicationErrors(published)
      if (errors.length) throw new Error(`Source-only задание ${task.id} на странице ${role} содержит недопустимые поля: ${errors.join(' ')}`)
    }
    const topology = (subjects) => subjects?.map((subject) => ({ id: subject.id,
      tasks: subject.tasks?.map((task) => ({ id: task.id, meshText: task.meshText,
        kind: task.kind, outputKind: task.outputKind, sourceOnly: task.sourceOnly === true,
        practiceVariants: task.practiceVariants?.map((variant) => ({ id: variant.id, title: variant.title, optionalByTeacher: variant.optionalByTeacher })),
        problems: task.problems?.map((problem) => ({ id: problem.id, variantId: problem.variantId,
          number: problem.number, title: problem.title, original: problem.original && {
            attachmentRef: problem.original.attachmentRef, text: problem.original.text,
          } })),
      })),
    }))
    const meshSubjects = (subjects) => subjects?.map((subject) => ({ ...subject,
      tasks: (subject.tasks ?? []).filter((task) => !task.familyOrigin),
    })).filter((subject) => subject.tasks.length || source.subjects.some((item) => item.id === subject.id))
    if (JSON.stringify(topology(meshSubjects(page.subjects))) !== JSON.stringify(topology(publicPageSubjects(source.subjects)))) {
      throw new Error(`Опубликованная страница ${role} потеряла задание, вариант или номер. Повторите публикацию и обратную сверку.`)
    }
    return
  }
  // Pages released before fingerprints still need an ID/text check. Their next
  // publication acquires the stronger fingerprint contract.
  const tasks = page.subjects?.flatMap((subject) => subject.tasks ?? []) ?? []
  for (const item of source.subjects?.flatMap((subject) => subject.tasks ?? []) ?? []) {
    const published = tasks.find((task) => task.id === item.id)
    if (!published || published.meshText !== item.meshText) {
      throw new Error(`Старая страница ${role} не содержит актуальное задание ${item.id}. Сначала day publish.`)
    }
  }
}
