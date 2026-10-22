import { describe, expect, it } from 'vitest'
import { publicPageSubjects } from '../day/public-projection.mjs'
import { assignmentAudio, audioLink, bindingErrors, boundAssignmentAudio, discoverAudio, resolveAssignmentAudio, starlightSource, verifyAudio } from './audio-library.mjs'

const source = (name) => `<a href="/english/starlight-6/${name}.mp3">listen</a>`
const bytes = Buffer.from('ID3 valid synthetic fixture')
const track = (name) => ({ ...discoverAudio(source(name))[0], ...verifyAudio(bytes), url: 'https://disk.yandex.ru/d/audio' })
const links = ['2-08 - Ex. 2a p. 30', '2-09 - Ex. 2a p. 31', '2-10 - Ex. 2b p. 31', 'wb-02 - Ex. 5 p. 15'].map(track).map(audioLink)
const library = { bookId: 'english', tracks: links }

describe('shared audio catalogue and exact assignment edges', () => {
  it('keeps SB, WB and test records distinct and deduplicates anchors', () => {
    const tracks = discoverAudio(source('2-09 - Ex. 2a p. 31') + source('wb-02 - Ex. 5 p. 15') + source('test-2') + source('test-2'))
    expect(tracks.map((item) => [item.kind, item.page, item.exercise])).toEqual([['sb', 31, '2a'], ['wb', 15, '5'], ['test', null, null]])
    expect(tracks.some((item) => 'childId' in item || 'familyId' in item)).toBe(false)
  })
  it('preserves checked source corrections and unusual source labels', () => {
    const tracks = discoverAudio('<a href="5-23 - Еx. 1 p. 96.mp3">x</a>' + source('3-09 - Ex. 2a 49.') + source('4-20 - Ex. s4a,b p.77'))
    expect(tracks[0].sourceCorrection).toContain('HTTP 200')
    expect(tracks[0].sourceHref).toBe('5-23 - Еx. 1 p. 96.mp3')
    expect(tracks.map((item) => item.exercise)).toEqual(['1', '2a', 's4a,b'])
  })
  it('rejects outside origins, unknown labels, empty pages and HTML instead of audio', () => {
    expect(() => discoverAudio('<a href="https://evil.example/x.mp3">x</a>')).toThrow()
    expect(() => discoverAudio(source('unknown'))).toThrow()
    expect(() => discoverAudio('<p>unavailable</p>')).toThrow()
    expect(() => verifyAudio(Buffer.from('<html>not found</html>'))).toThrow()
    expect(() => audioLink({ ...track('test-2'), url: 'https://tankmet.ru/audio.mp3' })).toThrow()
  })
  it('matches a specific subpart without adjacent page or part leakage', () => {
    expect(assignmentAudio({ meshText: 'SB упр.2a стр.31' }, library)).toEqual([links[1]])
    expect(assignmentAudio({ meshText: 'SB упр.2 стр.31' }, library)).toEqual([links[1], links[2]])
    expect(assignmentAudio({ meshText: 'WB упр.5 стр.15' }, library)).toEqual([links[3]])
  })
  it('does not invent links for page-only, ambiguous lists/ranges, mixed books or source gaps', () => {
    for (const meshText of ['SB стр.31', 'SB упр.2 стр.30-31', 'SB упр.2, 3 стр.31', 'SB упр.2 стр.31 WB упр.5 стр.15', 'упр.2 стр.31']) {
      expect(assignmentAudio({ meshText }, library)).toEqual([])
    }
    expect(assignmentAudio({ meshText: 'SB упр.2 стр.31', instructionStatus: { state: 'needs-review' } }, library)).toEqual([])
    expect(assignmentAudio({ meshText: 'SB упр.2 стр.31', materialStatus: { state: 'textbook-page-needed' } }, library)).toEqual([])
  })
  it('uses confirmed family page provenance for an implicit SB instruction', () => {
    expect(assignmentAudio({ meshText: 'упр.2a стр.31' }, library, [{ sourceType: 'textbook-page', sourceRef: 'english#pdf-0033' }])).toEqual([links[1]])
    expect(assignmentAudio({ meshText: 'упр.2a стр.31' }, library, [{ sourceType: 'textbook-page', sourceRef: 'other-book#pdf-0033' }])).toEqual([])
  })
  it('requires an explicit parent-selected public source and a confirmed child book', () => {
    const input = { familyId: 'f'.repeat(22), childId: 'c'.repeat(22), bookId: 'english', collectionId: 'starlight-6',
      evidence: { kind: 'parent-selected-public-audio', sourceUrl: starlightSource, note: 'Родитель прямо выбрал источник для английского языка своего ребёнка.' } }
    const book = { status: 'confirmed', subjectKey: 'английский язык' }, catalog = { state: 'ready', tracks: links }
    expect(bindingErrors(input, {}, book, catalog)).toEqual([])
    expect(bindingErrors(input, null, book, catalog)).not.toEqual([])
    expect(bindingErrors(input, {}, { ...book, status: 'provisional' }, catalog)).not.toEqual([])
    expect(bindingErrors({ ...input, evidence: {} }, {}, book, catalog)).not.toEqual([])
  })
  it('does not use another subject or a provisional binding', () => {
    const source = { subjects: [{ name: 'Английский язык', tasks: [{ id: 'task', meshText: 'SB упр.2a стр.31' }] }] }
    expect(boundAssignmentAudio(source, [{ status: 'provisional', audioLibrary: library }], {})).toEqual({})
    expect(boundAssignmentAudio(source, [{ bookId: 'english', status: 'confirmed', audioLibrary: library }], {})).toEqual({ task: [links[1]] })
  })
  it('resolves clarified audio for one task when WB pages/exercises are ambiguous and keeps the choice private', () => {
    const desired = { ...links[3], printedPage: 15, exercise: '5', exerciseType: 'exercise', audioKind: 'wb',
      sourceRef: 'audio:starlight-6-wb-02', sourceSha256: 'b'.repeat(64) }
    const desiredSecond = { ...audioLink(track('wb-03 - Ex. 6 p. 16')), printedPage: 16, exercise: '6',
      exerciseType: 'exercise', audioKind: 'wb', sourceRef: 'audio:starlight-6-wb-03', sourceSha256: 'c'.repeat(64) }
    const written = { id: 'mesh-ex4-written', kind: 'written', meshText: 'упр.4(пис) стр.31',
      instructionStatus: { state: 'reviewed' }, submission: { buttonLabel: 'Сдать решение' } }
    const repeat = { id: 'mesh-ex6-repeat', kind: 'check', meshText: 'WB, стр. 15 и 16, упр. 4, 5',
      instructionStatus: { state: 'reviewed' }, materialRequest: { id: 'source-ex6', state: 'resolved',
        resolvedTopic: 'По фото подтверждены WB, страницы 15 и 16, упражнения 4 и 5.', uploadIds: ['source-upload'] },
      assessmentIntent: { state: 'confirmed', topic: 'Правило к упражнению 6' }, testToken: 'repeat-test' }
    const source = { subjects: [{ name: 'Английский язык', tasks: [written, repeat] }] }
    const book = { bookId: 'english', status: 'confirmed', audioLibrary: { tracks: [desired, desiredSecond] } }
    const pageLinks = { [repeat.id]: [
      { sourceType: 'textbook-page', sourceRef: 'english#pdf-0016' },
      { sourceType: 'textbook-page', sourceRef: 'english#pdf-0017' },
    ] }
    const excerpt = 'На фото видны записи: упражнение 5 страница 15 и упражнение 6 страница 16.'
    const selections = { [repeat.id]: [desired, desiredSecond].map((track) => ({ bookId: 'english', sourceRef: track.sourceRef,
      sourceSha256: track.sourceSha256, evidence: { kind: 'source-material', ref: 'source-upload', excerpt } })) }
    const clarificationReviews = { [repeat.id]: { pagePlanRevision: 7, review: { taskId: repeat.id, planRevision: 7,
      purpose: 'source-material', uploadIds: ['source-upload'],
      sourceAnalysis: { requestId: 'source-ex6', evidence: [{ uploadId: 'source-upload', text: `На фото: ${excerpt}` }] } } } }
    const audio = resolveAssignmentAudio(source, [book], pageLinks, selections, clarificationReviews)
    expect(audio).toEqual({ [repeat.id]: [expect.objectContaining({ sourceRef: desired.sourceRef, sourceSha256: desired.sourceSha256 }),
      expect.objectContaining({ sourceRef: desiredSecond.sourceRef, sourceSha256: desiredSecond.sourceSha256 })] })
    expect(written).toMatchObject({ kind: 'written', submission: { buttonLabel: 'Сдать решение' } })
    expect(written.testToken).toBeUndefined()
    expect(repeat).toMatchObject({ kind: 'check', testToken: 'repeat-test', assessmentIntent: { state: 'confirmed' } })
    const publishedShape = { subjects: publicPageSubjects(source.subjects), materialLinks: audio }
    expect(JSON.stringify(publishedShape)).not.toContain('audioSelections')
    expect(JSON.stringify(publishedShape)).not.toContain(excerpt)
    const repeated = resolveAssignmentAudio(source, [book], pageLinks, selections, {
      [repeat.id]: { ...clarificationReviews[repeat.id], pagePlanRevision: 8 },
    })
    expect(repeated).toEqual(audio)
    expect(() => resolveAssignmentAudio(source, [book], pageLinks, selections, {
      [repeat.id]: { ...clarificationReviews[repeat.id], pagePlanRevision: 8,
        review: { ...clarificationReviews[repeat.id].review, planRevision: 9 } },
    })).toThrow(/не подтверждено/)
    expect(() => resolveAssignmentAudio(source, [book], pageLinks, selections, {
      [repeat.id]: { ...clarificationReviews[repeat.id], pagePlanRevision: 8,
        review: { ...clarificationReviews[repeat.id].review, planRevision: 0 } },
    })).toThrow(/не подтверждено/)
  })
  it('fails closed for a bad explicit choice, wrong family book, unresolved material, foreign task evidence, or duplicates', () => {
    const first = { id: 'repeat-one', kind: 'check', meshText: 'WB упр.5 стр.15', instructionStatus: { state: 'reviewed' } }
    const second = { ...first, id: 'repeat-two' }
    const source = { subjects: [{ name: 'Английский язык', tasks: [first, second] }] }
    const book = { bookId: 'english', status: 'confirmed', audioLibrary: { tracks: [links[3]] } }
    const pages = { [first.id]: [{ sourceType: 'textbook-page', sourceRef: 'english#page-15' }],
      [second.id]: [{ sourceType: 'textbook-page', sourceRef: 'english#page-15' }] }
    const mesh = { bookId: 'english', sourceRef: links[3].sourceRef, sourceSha256: links[3].sourceSha256,
      evidence: { kind: 'mesh', ref: first.id, excerpt: 'WB упр.5 стр.15' } }
    expect(() => resolveAssignmentAudio(source, [book], pages, { [first.id]: [{ ...mesh, sourceSha256: '0'.repeat(64) }] })).toThrow(/отсутствует/)
    expect(() => resolveAssignmentAudio(source, [book], pages, { [first.id]: [{ ...mesh, bookId: 'foreign' }] })).toThrow(/Книга аудиопривязки/)
    expect(() => resolveAssignmentAudio(source, [book], pages, { unknown: [mesh] })).toThrow(/неизвестное задание/)
    expect(() => resolveAssignmentAudio(source, [book], pages, { [first.id]: mesh })).toThrow(/некорректный формат/)
    expect(() => resolveAssignmentAudio(source, [book], pages, { [first.id]: [] })).toThrow(/некорректный формат/)
    expect(() => resolveAssignmentAudio(source, [book], pages, { [first.id]: [mesh, mesh] })).toThrow(/повторена внутри задания/)
    const clarificationTask = { ...first, materialRequest: { id: 'req-first', state: 'resolved', resolvedTopic: 'Тема', uploadIds: ['up-first'] } }
    const sourceMaterial = { bookId: 'english', sourceRef: links[3].sourceRef, sourceSha256: links[3].sourceSha256,
      evidence: { kind: 'source-material', ref: 'up-first', excerpt: 'Фото подтверждает WB exercise five.' } }
    expect(() => resolveAssignmentAudio({ subjects: [{ name: 'Английский язык', tasks: [{ ...first, materialRequest: { id: 'req-first', state: 'open' } }] }] },
      [book], pages, { [first.id]: [sourceMaterial] })).toThrow(/проверенное задание/)
    expect(() => resolveAssignmentAudio({ subjects: [{ name: 'Английский язык', tasks: [clarificationTask] }] }, [book], pages,
      { [first.id]: [sourceMaterial] }, {})).toThrow(/не подтверждено/)
    const wrongEvidence = { [first.id]: { pagePlanRevision: 7, review: { taskId: second.id, planRevision: 7,
      purpose: 'source-material', uploadIds: ['up-first'],
      sourceAnalysis: { requestId: 'req-first', evidence: [{ uploadId: 'up-first', text: 'Фото подтверждает WB exercise five.' }] } } } }
    expect(() => resolveAssignmentAudio({ subjects: [{ name: 'Английский язык', tasks: [clarificationTask] }] },
      [book], pages, { [first.id]: [sourceMaterial] }, wrongEvidence)).toThrow(/не подтверждено/)
    const staleEvidence = { [first.id]: { ...wrongEvidence[first.id], pagePlanRevision: 8, review: { ...wrongEvidence[first.id].review,
      taskId: first.id } } }
    expect(resolveAssignmentAudio({ subjects: [{ name: 'Английский язык', tasks: [clarificationTask] }] },
      [book], pages, { [first.id]: [sourceMaterial] }, staleEvidence)[first.id]).toHaveLength(1)
    const replacedRequest = { ...clarificationTask, materialRequest: { ...clarificationTask.materialRequest, id: 'req-replaced' } }
    expect(() => resolveAssignmentAudio({ subjects: [{ name: 'Английский язык', tasks: [replacedRequest] }] },
      [book], pages, { [first.id]: [sourceMaterial] }, staleEvidence)).toThrow(/не подтверждено/)
    const secondTask = { ...second, materialRequest: { id: 'req-second', state: 'resolved', resolvedTopic: 'Тема', uploadIds: ['up-first'] } }
    const ownReview = (taskId, requestId) => ({ pagePlanRevision: 7, review: { taskId, planRevision: 7,
      purpose: 'source-material', uploadIds: ['up-first'],
      sourceAnalysis: { requestId, evidence: [{ uploadId: 'up-first', text: sourceMaterial.evidence.excerpt }] } } })
    const reuse = resolveAssignmentAudio({ subjects: [{ name: 'Английский язык', tasks: [
      clarificationTask, secondTask,
    ] }] }, [book], pages, { [first.id]: [sourceMaterial], [second.id]: [sourceMaterial] },
    { [first.id]: ownReview(first.id, 'req-first'), [second.id]: ownReview(second.id, 'req-second') })
    expect(Object.keys(reuse)).toEqual([first.id, second.id])
    expect(reuse[first.id]).toEqual(reuse[second.id])
  })
})
