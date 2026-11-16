import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import MaterialRequest from './MaterialRequest'
const request={id:'example-pages',state:'open' as const,question:'Длинное служебное описание поиска.',photoPrompt:'Повторяющаяся инструкция к фотографии.',presentation:{version:1 as const,available:['Учебник и уже присланные страницы 8–9'],missing:['Рабочая тетрадь: страница 10'],reason:'В учебнике другое упражнение.',action:'Добавь только страницу 10.',checkedAt:'2026-11-16T12:00:00Z',checkedSources:['Библиотека','Архив фото']}}
it('shows a structured explanation once in both roles, instead of serializing the operator report',()=>{
 for(const parent of [false,true]){
  const html=renderToStaticMarkup(<MaterialRequest request={request} label="Нужен материал для уточнения" detail={request.question} parent={parent}/>)
  for(const label of ['Чего не хватает','Уже есть','Почему этого недостаточно','Где проверено'])expect(html).toContain(label)
  expect(html).not.toContain(request.question);expect(html).not.toContain(request.photoPrompt)
  expect(html).not.toContain('Нужен материал для уточнения');expect(html).toContain('data-presentation-contract="source-request"')
 }
})
it('does not ask to upload again while the received material is awaiting review',()=>{
 const html=renderToStaticMarkup(<MaterialRequest request={request} phase="received" label="Материал получен" detail="Проверяем присланное."/>)
 expect(html).toContain('Материал получен');expect(html).not.toContain(request.presentation.action)
})
