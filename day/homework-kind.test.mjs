import {expect,it} from 'vitest'
import {rawMeshKind,hasAssignedPlatformWork,platformAssignmentErrors} from './homework-kind.mjs'
it.each(['п.38','§8, вопросы 5–7'])('does not invent digital work from counters or authored platform fields: %s',meshText=>{
 const task={kind:'check',meshText,outputKind:'platform-result',materialCounts:{count_execute:1},instructionStatus:{state:'reviewed'},detail:'Выполни ЦДЗ',submission:{photo:'Пришли результат ЦДЗ'}}
 expect(hasAssignedPlatformWork(task)).toBe(false);expect(platformAssignmentErrors(task).join()).toContain('не создают обязанность')
 expect(platformAssignmentErrors({...task,meshText:'ЦДЗ по теме урока'})).toEqual([])
})
it('accepts an explicit teacher action and keeps parent practice a separate source',()=>{
 expect(hasAssignedPlatformWork({meshText:'Пройти тест в МЭШ по теме «Вода»'})).toBe(true)
 expect(hasAssignedPlatformWork({meshText:'Циклы и условия: тренировочные работы https://example.org/task/1'})).toBe(true)
 expect(hasAssignedPlatformWork({meshText:'ЦДЗ не задано'})).toBe(false)
 expect(hasAssignedPlatformWork({meshText:'п.38',detail:'Пройти тест в МЭШ',familyOrigin:{sourceSystem:'family'}})).toBe(true)
 expect(hasAssignedPlatformWork({meshText:'п.38',steps:[{source:{kind:'textbook',certainty:'confirmed',excerpt:'ЦДЗ',evidence:'ЦДЗ'}}]})).toBe(false)
})
it('also fences a forged graph rule and a leftover upload request on a reading card',()=>{
 for(const extra of [{decisionRuleIds:['common.platform']},{submission:{buttonLabel:'Загрузить результат ЦДЗ'}},{platformResult:{state:'completed',correct:8,total:8}}])expect(platformAssignmentErrors({meshText:'п.38',outputKind:'reading',...extra})).toHaveLength(1)
})
it.each(['ЦДЗ выполнять не нужно. Читать п.38.','Не надо выполнять ЦДЗ. Читать п.38.','ЦДЗ не требуется; п.38.','ЦДЗ не задано'])('does not interpret an explicit exclusion as a platform obligation: %s',meshText=>expect(hasAssignedPlatformWork({meshText})).toBe(false))
it('keeps finishing a workbook and bringing it for checking in the written branch',()=>{
 expect(rawMeshKind('доделать р.т. 2 модуль до 23 стр(принести на проверку)')).toBe('written')
 expect(rawMeshKind('Закончить рабочую тетрадь до страницы 23')).toBe('written')
})
it('does not turn studying notes or reading a workbook into a written submission',()=>{
 expect(rawMeshKind('Учим записи в тетрадях.')).toBe('check')
 expect(rawMeshKind('См. записи в тетради. Подготовиться к контрольной.')).toBe('check')
 expect(rawMeshKind('Прочитать текст в рабочей тетради.')).toBe('check')
})
