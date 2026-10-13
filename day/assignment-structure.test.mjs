import { describe, expect, it } from 'vitest'
import { teacherAttachmentOwnershipErrors, teacherFilesForEntry } from './assignment-structure.mjs'

const assignments = {
  subjects: [{ id: 'math', tasks: [{ id: 'mesh-1' }, { id: 'mesh-2' }] }],
  materialLinks: {
    'mesh-1': [{ sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:geometry', title: 'Геометрия' }],
    'mesh-2': [{ sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:ratios', title: 'Пропорции' }],
  },
}

describe('границы отдельных заданий в одном предмете', () => {
  it('сохраняет у каждого задания собственный лист', () => {
    expect(teacherAttachmentOwnershipErrors(assignments)).toEqual([])
  })
  it('останавливает публикацию, когда оба листа скопированы в оба задания', () => {
    const mixed = structuredClone(assignments)
    mixed.materialLinks['mesh-1'].push(mixed.materialLinks['mesh-2'][0])
    mixed.materialLinks['mesh-2'].push(mixed.materialLinks['mesh-1'][0])
    expect(teacherAttachmentOwnershipErrors(mixed)).toEqual(expect.arrayContaining([
      expect.stringMatching(/geometry.*mesh-1.*mesh-2/),
      expect.stringMatching(/ratios.*mesh-1.*mesh-2/),
    ]))
  })
  it('разрешает подтверждённый общий лист с явной пометкой на обеих связях', () => {
    const shared = structuredClone(assignments)
    const link = { sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:shared', title: 'Общий лист', sharedAcrossTasks: true }
    shared.materialLinks['mesh-1'].push(link)
    shared.materialLinks['mesh-2'].push(link)
    expect(teacherAttachmentOwnershipErrors(shared)).toEqual([])
  })
  it('не размножает файлы урока по двум заданиям без доказанной связи', () => {
    const lesson = { teacherFiles: [{ id: 'geometry' }, { id: 'ratios' }] }
    const entries = [{ id: 'one' }, { id: 'two' }]
    expect(teacherFilesForEntry(lesson, entries[0], entries)).toEqual([])
    expect(teacherFilesForEntry(lesson, entries[1], entries)).toEqual([])
    expect(teacherFilesForEntry(lesson, entries[0], [entries[0]])).toEqual(lesson.teacherFiles)
  })
  it('берёт только файл с явным ID задания, если МЭШ его отдаёт', () => {
    const lesson = { teacherFiles: [{ id: 'geometry', homeworkEntryId: 'one' }, { id: 'ratios', homeworkEntryId: 'two' }] }
    const entries = [{ id: 'one' }, { id: 'two' }]
    expect(teacherFilesForEntry(lesson, entries[0], entries)).toEqual([lesson.teacherFiles[0]])
    expect(teacherFilesForEntry(lesson, entries[1], entries)).toEqual([lesson.teacherFiles[1]])
  })
  it('не теряет файл, когда вторая запись лишь указывает «Файл здесь»', () => {
    const lesson = { teacherFiles: [{ id: 'sheet' }] }
    const entries = [{ id: 'main', description: 'Решить задания из файла' }, { id: 'pointer', description: 'Файл здесь' }]
    expect(teacherFilesForEntry(lesson, entries[0], entries)).toEqual(lesson.teacherFiles)
  })
})
