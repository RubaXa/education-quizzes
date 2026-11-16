import {expect,it} from 'vitest'
import {rawMeshKind} from './homework-kind.mjs'
it('keeps finishing a workbook and bringing it for checking in the written branch',()=>{
 expect(rawMeshKind('доделать р.т. 2 модуль до 23 стр(принести на проверку)')).toBe('written')
 expect(rawMeshKind('Закончить рабочую тетрадь до страницы 23')).toBe('written')
})
it('does not turn studying notes or reading a workbook into a written submission',()=>{
 expect(rawMeshKind('Учим записи в тетрадях.')).toBe('check')
 expect(rawMeshKind('См. записи в тетради. Подготовиться к контрольной.')).toBe('check')
 expect(rawMeshKind('Прочитать текст в рабочей тетради.')).toBe('check')
})
