import {expect,it} from 'vitest'
import {homeworkText,homeworkContent} from './homework-content.mjs'
it('ignores whitespace and exact duplicate copies, retaining real numbers and obligations',()=>{
 expect(homeworkText(' §44\n Упр.292 ')).toBe(homeworkText('§44 Упр.292'))
 expect(homeworkText('Учим записи.; Учим записи.')).toBe(homeworkText('Учим записи.'))
 expect(homeworkText('Упр.292')).not.toBe(homeworkText('Упр.293'))
 expect(homeworkText('§44')).not.toBe(homeworkText('§44; ЦДЗ'))
})
it('ignores updatedAt alone but retains identities, attachment revisions and evidence',()=>{
 const a={homeworkEntries:[{id:1,description:'Прочитать §44',updatedAt:'yesterday'}],teacherFiles:[{id:5,title:'лист.pdf',sha256:'one'}]}
 expect(homeworkContent(a)).toEqual(homeworkContent({...a,homeworkEntries:[{...a.homeworkEntries[0],updatedAt:'today'}]}))
 expect(homeworkContent(a)).not.toEqual(homeworkContent({...a,teacherFiles:[{...a.teacherFiles[0],sha256:'two'}]}))
 expect(homeworkContent(a)).not.toEqual(homeworkContent({...a,homeworkEntries:[{...a.homeworkEntries[0],id:2}]}))
})
