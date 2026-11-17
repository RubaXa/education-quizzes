/** @see ../../docs/decisions/restore-parent-route-2026-11-17.md */
/** One public-domain literary case with a deliberately synthetic pupil answer.
 * @see ../../docs/modules/reviews/parent-review.md */
/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
import {useState} from 'react'
import QuizResultCard from '@/components/QuizResultCard'
import type {QuestionResult} from '@/lib/quiz'
import type {ParentReviewAnalysis} from '../../packages/education-presentation/parent-review.mjs'
export const parentPilotAnalysis:ParentReviewAnalysis={version:1,
 answer:'Владимир велел отпереть дверь; Архип, вопреки поручению, запер её на ключ.',
 difference:'В условном ответе действия переставлены местами: запирание названо поручением Владимира, а открывание — поступком Архипа.',
 method:{name:'Поручение → поступок → сравнение',reason:'Отделяем предположение героя о прошлом от его поручения и последующего действия.',steps:['Выделить поручение','Проверить действие Архипа','Сопоставить с ответом']},
 blocks:[{kind:'cases',label:'Фрагменты эпизода',cases:[
  {label:'Слова о прошлом',blocks:[{kind:'text',text:'«кажется, второпях я запер двери»'}],result:'Владимир предполагает, что сделал раньше. Это не поручение.'},
  {label:'Поручение',blocks:[{kind:'text',text:'«поди скорее отопри их»'}],result:'Владимир поручил отпереть дверь.'},
  {label:'Поступок Архипа',blocks:[{kind:'text',text:'«Архип запер их на ключ»'}],result:'Архип сделал противоположное поручению.'}]},
  {kind:'text',title:'Проверяем последовательность',text:'Когда Архип вошёл в сени, двери были отперты. Он запер их на ключ. Следовательно, открывание нельзя назвать его поступком в этом эпизоде.'}],
 source:{label:'Литература 6, Коровина, часть1, 2024',location:'«Дубровский», главаVI, с.156 (PDF157)'}}
export const parentPilotResult:QuestionResult={question:{id:'demo-parent-door',kind:'single',prompt:'Чем поступок Архипа отличается от поручения Владимира?',points:1,options:[{id:'reverse',label:'Архип — открыть; Владимир — закрыть.'},{id:'right',label:'Владимир — открыть; Архип — закрыть.'}]},answer:'reverse',points:0,
 guidance:{observation:'В условном ответе действия героев переставлены местами. Сначала проверь только поручение.',question:'Какое действие Владимир поручил сделать с дверью?',source:{title:'Литература 6',edition:'Коровина, 2024',pages:'156',section:'ГлаваVI',locator:'Разговор о двери'},presentation:{version:1,activity:{kind:'choice',label:'Поручение Владимира',instruction:'Найди реплику на с.156. Выбери одно действие.',tokens:[{id:'open',text:'Открыть дверь'},{id:'lock',text:'Запереть дверь'},{id:'prop',text:'Подпереть дверь'}]}}}}
export default function ParentReviewPilotExample(){
 const [role,setRole]=useState<'both'|'parent'|'student'>('both')
 return <section id="review-roles" aria-label="Одна задача — две роли"><h3>Одна задача — две роли</h3><p>Условный ответ. Родитель проверяет по полному разбору; ребёнок работает над своим текущим шагом. Это рабочие компоненты, семейных записей здесь нет.</p>
 <p><code>view.role → view.parent-review / view.student-support → view.component</code></p>
 <div className="edu-kit-presets" aria-label="Роли одного разбора">{([['both','Обе роли'],['parent','Родитель'],['student','Ребёнок']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={role===value} onClick={()=>setRole(value)}>{label}</button>)}</div>
 {role!=='student'&&<section aria-label="Пример: родитель"><h4>Родитель</h4><QuizResultCard result={parentPilotResult} index={0} parent parentReview={{state:'ready',analysis:parentPilotAnalysis}}/></section>}
 {role!=='parent'&&<section aria-label="Пример: ребёнок"><h4>Ребёнок</h4><QuizResultCard result={parentPilotResult} index={0}/></section>}
 </section>
}
