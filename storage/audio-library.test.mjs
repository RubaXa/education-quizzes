import { describe, expect, it } from 'vitest'
import { assignmentAudio, audioLink, bindingErrors, boundAssignmentAudio, discoverAudio, starlightSource, verifyAudio } from './audio-library.mjs'

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
})
