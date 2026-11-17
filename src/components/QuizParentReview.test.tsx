import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import {readFileSync,existsSync} from 'node:fs'
import {presentationContracts} from '../../packages/education-presentation/task-presentation.mjs'
import QuizResultCard from './QuizResultCard'
const analysis={version:1,answer:'Владимир поручил отпереть дверь; Архип запер её на ключ.',difference:'В условном ответе поручение и поступок переставлены местами.',method:{name:'Поручение → поступок → сравнение',reason:'Различаем предположение, просьбу и действие.',steps:['Прочитать реплику','Проверить поступок','Сравнить ответ']},blocks:[{kind:'visual',visual:{kind:'comparison',label:'Сверка действий',columns:['Кто','Что сделал'],rows:[{cells:['Владимир','Велел отпереть']},{cells:['Архип','Запер на ключ']}] }},{kind:'text',title:'Вывод',text:'Поручение и фактическое действие различаются.'}],source:{label:'Литература 6, часть 1',location:'Глава VI, с.156'}}
const result={question:{id:'door',kind:'single',prompt:'Сопоставь поручение и поступок.',points:1},answer:'a',points:0,guidance:{observation:'Проверь, кому приписано каждое действие.',question:'Какое действие герой поручил сделать?',source:{title:'Книга',edition:'Издание',pages:'156',section:'VI',locator:'Реплика'},presentation:{version:1,activity:{kind:'choice',label:'Поручение',instruction:'Найди реплику и выбери действие.',tokens:[{id:'a',text:'Первое действие'},{id:'b',text:'Второе действие'}]}}}}
it('parent gets the correct answer, exact difference and a full structured method rather than the learner question',()=>{
 const html=renderToStaticMarkup(createElement(QuizResultCard,{result,index:0,parent:true,parentReview:{state:'ready',analysis}} as any))
 for(const text of ['Правильный ответ',analysis.answer,'Что перепутано',analysis.difference,'Ход решения','Поручение → поступок → сравнение','Сверка действий','Велел отпереть','Запер на ключ','0 из 1 баллов'])expect(html).toContain(text)
 expect(html).not.toContain(result.guidance.question);expect(html).not.toContain('role="radio"');expect(html).not.toContain('<input');expect(html).not.toContain('Отправить ответ')
 expect(html).toContain('day-parent-guide day-parent-learning-route')
 expect(html).toContain('Ход решения')
 expect(html).toContain('day-learning-route-stage')
 expect(html).not.toContain('Ход разбора')
})
it('learner keeps one supported step with no private parent answer or parent method anywhere in the DOM',()=>{
 const html=renderToStaticMarkup(createElement(QuizResultCard,{result,index:0,parent:false,parentReview:{state:'ready',analysis}} as any))
 expect(html).toContain(result.guidance.question);expect(html).toContain('role="radio"')
 for(const text of [analysis.answer,analysis.difference,analysis.method.name,'Правильный ответ','Ход разбора','Велел отпереть','Запер на ключ'])expect(html).not.toContain(text)
})
it('binds the parent graph contract and the real adapter to the approved route instead of a second renderer',()=>{
 expect(presentationContracts['parent-review'].components).toContain('ParentTaskGuide')
 const adapter=readFileSync('src/components/ParentReviewContent.tsx','utf8')
 expect(adapter).toContain("import ParentTaskGuide from './ParentTaskGuide'")
 expect(adapter).not.toMatch(/from ['"]\.\/SolutionBlocks|import ['"]\.\/ParentReviewContent\.css/)
 expect(existsSync('src/components/ParentReviewContent.css')).toBe(false)
})
