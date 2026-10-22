import { createHash } from 'node:crypto'
import { boundAssignmentAudio } from '../storage/audio-library.mjs'

/** Rebuilds a source graph from this family's current facts on every publication.
 * @see ../docs/modules/materials/family-library.md#source-graph
 */
export async function buildFamilySourceGraph(db, { familyId, childId, source, pageRefs }) {
  const base = `families/${familyId}/children/${childId}`
  const [child, books, requirements, methods] = await Promise.all([
    db.doc(base).get(), db.collection(`${base}/books`).get(),
    db.collection(`${base}/bookRequirements`).get(), db.collection(`families/${familyId}/methodMaterials`).get(),
  ])
  if (!child.exists) throw new Error('Связь ребёнка с семьёй для графа источников не найдена.')
  const byBook = new Map(books.docs.map((item) => [item.id, item.data()]))
  const bySubject = new Map(requirements.docs.map((item) => [item.data().subjectKey, item.data().policy]))
  const nodes = [{ id: `child:${childId}`, kind: 'child', familyId }]
  const edges = []
  const problems = []
  for (const item of books.docs) nodes.push({ id: `book:${item.id}`, kind: 'family-book', bookId: item.id,
    status: item.data().status, sourceSha256: item.data().sourceSha256,
    evidenceKind: item.data().evidence?.kind ?? null })
  for (const item of requirements.docs) nodes.push({ id: `requirement:${item.data().subjectKey}`,
    kind: 'family-book-policy', subjectKey: item.data().subjectKey, policy: item.data().policy })
  for (const item of methods.docs) {
    const data = item.data()
    if (data.status !== 'confirmed') continue
    nodes.push({ id: `method:${item.id}`, kind: 'school-method', subjectKey: data.subjectKey,
      schoolYear: data.schoolYear ?? null, sourceRef: data.sourceRef ?? null })
  }
  for (const subject of source.subjects ?? []) {
    const key = subject.name.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim()
    for (const task of subject.tasks ?? []) {
      const taskNode = `task:${task.id}`
      nodes.push({ id: taskNode, kind: 'mesh-assignment', subjectKey: key,
        textSha256: createHash('sha256').update(JSON.stringify(task)).digest('hex'),
        materialState: task.materialStatus?.state ?? null })
      edges.push({ from: `child:${childId}`, to: taskNode, relation: 'assigned-to' })
      if (bySubject.get(key) === 'no-book') edges.push({ from: taskNode, to: `requirement:${key}`, relation: 'family-no-book' })
      for (const method of methods.docs) if (method.data().status === 'confirmed' && method.data().subjectKey === key) {
        edges.push({ from: taskNode, to: `method:${method.id}`, relation: 'candidate-method' })
      }
      for (const [index, result] of (source.sourcePacks?.[task.id]?.online ?? []).entries()) {
        if (typeof result.url !== 'string' || !result.url.startsWith('https://')) continue
        const resultId = `online:${task.id}:${index}`
        nodes.push({ id: resultId, kind: 'published-answer-candidate', url: result.url,
          sourceKind: result.sourceKind ?? 'unknown', match: result.match ?? 'unverified',
          checkedAt: result.checkedAt ?? null })
        edges.push({ from: taskNode, to: resultId, relation: 'researched-answer' })
      }
      for (const ref of pageRefs[task.id] ?? []) {
        const bookId = ref.slice(0, ref.lastIndexOf('#'))
        const binding = byBook.get(bookId)
        nodes.push({ id: `page:${ref}`, kind: 'textbook-page-ref', bookId, ref })
        edges.push({ from: taskNode, to: `page:${ref}`, relation: 'uses-page' })
        edges.push({ from: `page:${ref}`, to: `book:${bookId}`, relation: 'from-edition' })
        if (child.data().libraryPolicyVersion === 1 && (binding?.status !== 'confirmed'
          || !['exact-file-sha256', 'family-upload-indexed', 'same-edition-verified', 'legacy-family-evidence'].includes(binding.evidence?.kind))) {
          problems.push(`Задание ${task.id} ссылается на ${bookId}, но семейное издание не подтверждено.`)
        }
      }
      for (const link of source.materialLinks?.[task.id] ?? []) if (link.sourceType === 'teacher-attachment') {
        const attachmentId = `teacher:${task.id}:${edges.length}`
        nodes.push({ id: attachmentId, kind: 'teacher-attachment', sourceRef: link.sourceRef ?? null })
        edges.push({ from: taskNode, to: attachmentId, relation: 'teacher-provided' })
      }
    }
  }
  return { schemaVersion: 1, familyId, childId, libraryPolicyVersion: child.data().libraryPolicyVersion ?? 0,
    audioLinks: boundAssignmentAudio(source, books.docs.map((item) => ({ ...item.data(), bookId: item.id })), Object.fromEntries(Object.entries(pageRefs ?? {}).map(([taskId, refs]) => [taskId, [...(source.materialLinks?.[taskId] ?? []), ...refs.map((ref) => ({ sourceType: 'textbook-page', sourceRef: ref }))]]))),
    nodes: [...new Map(nodes.map((node) => [node.id, node])).values()], edges, problems,
    generatedAt: new Date().toISOString() }
}
