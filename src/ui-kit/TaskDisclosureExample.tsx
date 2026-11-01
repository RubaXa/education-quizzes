/** Synthetic assignments through the same compact heading and existing body components.
 * @see ../../docs/modules/school-diary/day-page.md#task-disclosure */
import {useState} from 'react'
import TaskDisclosure from '@/components/TaskDisclosure'
import AssignmentBrief from '@/components/AssignmentBrief'
import StatusIcon from '@/components/StatusIcon'
import QuizCard from '@/components/QuizCard'
import {ResultBadge} from '@/components/ui/result'
import {quizResultInput} from '@/lib/quizCardViewModel'
import {uiKitQuizExamples} from '@/lib/uiKitExamples'
import type {DayTask} from '@/lib/dayStore'
const examples:DayTask[]=[{id:'demo-fett',kind:'written',status:'unknown',title:'ФЕТТ: пройти отборочный тур на каникулах',detail:'Пройти отборочный тур для своего класса на площадке организатора.',source:'МЭШ',meshText:'Пока каникулы — пройти отборочный тур.'},{id:'demo-cdz',kind:'check',status:'unknown',title:'ЦДЗ: действия с обыкновенными и десятичными дробями',detail:'Выполнить ЦДЗ.',source:'МЭШ',meshText:'Выполнить ЦДЗ по теме дробей.'}]
export default function TaskDisclosureExample(){
 const [checked,setChecked]=useState(false),latest=uiKitQuizExamples.at(-1)!
 return <section aria-label="Свёрнутые задания"><h2>Карточки заданий</h2><p>Условные данные. Все карточки закрыты при входе. Заголовок, статус и счётчик остаются видимыми; раскрытие сохраняет запись.</p><div className="day-task-list">
  {examples.map((task,index)=><TaskDisclosure id={task.id} key={task.id} className={`day-task${index?' submitted':''}`} title={task.title} status={<span className={`day-task-state ${index?'partial':'unknown'}`}><StatusIcon size={15} status={index?checked?'complete':'waiting':'unknown'}/>{index?checked?'ЦДЗ выполнено':'Скриншот ЦДЗ получен · ждёт проверки':'Статус неизвестен'}</span>} assignmentLabel={`Задание ${index+1} из 2`} meta={index?'ЦДЗ':'В тетради'}><AssignmentBrief task={task} materialLinks={[]}/><label style={{display:'grid',gap:6,fontSize:16}}>Моя заметка<input style={{minHeight:44,fontSize:16}}/></label></TaskDisclosure>)}
  <TaskDisclosure id="demo-quiz-task" title="Чтение: подготовить ответ по параграфу" status={<ResultBadge input={quizResultInput(latest)} showPoints/>} meta={`Самопроверка · вопросов: ${latest.total}`}><QuizCard chain={uiKitQuizExamples} parent={false} headingProvided="Чтение: подготовить ответ по параграфу" linksEnabled={false}/></TaskDisclosure>
  </div><div className="edu-kit-presets"><button onClick={()=>setChecked(v=>!v)}>Обновить статус ЦДЗ в примере</button></div></section>
}
