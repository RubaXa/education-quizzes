import type { CachedHomeworkRow } from './dayDashboardViewCache'
import type { QuizCardAttempt } from './quizCardViewModel'

/** Arithmetic-consistent fictional data only. Never import a family export here.
 * @see ../../docs/shared/design/ui-kit.md */
function sampleAttempt(id:string, points:number, maxPoints:number, count:number, correct:number, date:string):QuizCardAttempt {
  return {token:`example-${id}`,testId:id,title:id==='first'?'Исходная проверка темы':id==='repair'?'Повторение ошибок':'Закрепление навыка',slug:'example',status:'submitted',answered:count,total:count,points,maxPoints,createdAt:date,submittedAt:date,
    results:Array.from({length:count},(_,index) => {const weight=id==='first'?[2,2,1,1,2,2,1][index]:id==='repair'?[2,2,1,1,1][index]:1; return ({question:{id:`${id}-${index}`,kind:'short',prompt:index<correct?'Вопрос с верным ответом':'Как называется руководитель монастыря?',points:weight},answer:index<correct?'Верно':'Патриарх',points:index<correct?weight:0})})}
}
export const uiKitQuizExamples = [sampleAttempt('first',6,11,7,4,'2026-10-14T16:00:00Z'),sampleAttempt('repair',0,7,5,0,'2026-10-15T16:00:00Z'),sampleAttempt('latest',5,5,5,5,'2026-10-16T09:00:00Z')]

/** Fictional overview states; the real HomeworkOverview renders the demo. @see ../../docs/modules/school-diary/dashboard.md#compact-homework */
export const uiKitHomeworkRows:CachedHomeworkRow[] = [
 {subject:{id:'example-english',name:'Английский язык',icon:'🇬🇧',tasks:[{title:'Упр. 4, стр. 29'}]},group:'action',done:0,items:[{id:'example-english-task',title:'Упр. 4, стр. 29',state:'todo',detail:'Проверь два ответа в диалогах.'}]},
 {subject:{id:'example-russian',name:'Русский язык',icon:'✍️',tasks:[{title:'Упр. 218 и 223'}]},group:'waiting',done:1,items:[{id:'example-russian-task',title:'Упр. 218 и 223',state:'unclear',unresolvedReason:'missing-evidence',detail:'№ 218 проверен; № 223 не виден целиком.'}]},
 {subject:{id:'example-math',name:'Математика',icon:'∑',tasks:[{title:'Вычитание дробей'}]},group:'complete',done:1,items:[{id:'example-math-task',title:'Вычитание дробей',state:'done',detail:'Результат подтверждён.'}]},
]
