import {expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import WorkReview from './WorkReview'
import type {DayWorkReview} from '@/lib/dayStore'
const review:DayWorkReview={id:'context',taskId:'mesh-123',contextEvidence:[{id:'receipt',purpose:'context-evidence',type:'platform-result',title:'Гидросфера',points:10,maxPoints:10,duration:3,observedDate:'2026-11-16',uploadId:'photo',location:'Результат тематического теста',summary:'Результат на присланном снимке сохранён.'}]}
it.each([false,true])('shows the same context receipt without a verdict or a new learner action (parent=%s)',parent=>{
 const html=renderToStaticMarkup(<WorkReview review={review} uploads={[]} parent={parent}/>)
 expect(html).toContain('Гидросфера: 10/10')
 expect(html).toContain('Результат сохранён')
 expect(html).toContain('16 ноября · 3 мин')
 expect(html).toContain('Результат платформы')
 for(const text of ['Всё верно','Засчитать задачу','Не удалось','Нужно исправить','Отправить','Непонятно','ждёт проверки'])expect(html).not.toContain(text)
})
it('keeps a previous assignment review alongside the distinct context result',()=>{
 const html=renderToStaticMarkup(<WorkReview review={{...review,status:'verified',studentFeedback:{title:'Чтение проверено',confirmed:'Самопроверка: восемь из восьми.',focus:'',question:''}}} uploads={[]} />)
 expect(html).toContain('Самопроверка: восемь из восьми.')
 expect(html).toContain('Гидросфера: 10/10')
})
