/** @see ../../docs/decisions/quiz-runner-kit-audit-2026-11-01.md */
/** @see ../../docs/modules/assessments/quizzes.md */
import {useState} from 'react'
import QuestionCard from '@/components/QuizQuestionCard'
import {ThemeFrame,ThemeHero} from '@/components/SubjectTheme'
import type {Answer,QuizQuestion} from '@/lib/quiz'
const questions:QuizQuestion[]=[
 {id:'single',kind:'single',prompt:'Выбери запись, которая подходит к условию: места достаточно для всех книг.',points:1,options:[{id:'a',label:'The box is big enough for all the books.'},{id:'b',label:'The box is enough big for all the books.'}]},
 {id:'multiple',kind:'multiple',prompt:'Выбери все примеры по условию. Здесь можно отметить несколько строк.',points:2,options:[{id:'a',label:'Первый достаточно длинный вариант для проверки переноса текста.'},{id:'b',label:'Второй вариант тоже должен полностью помещаться в карточку.'}]},
 {id:'code',kind:'number',prompt:'Какое число напечатает программа?',points:1,code:'s = 0\nfor x in range(1, 4):\n    s += x\nprint(s)'},
 {id:'short',kind:'short',prompt:'Впиши одно слово по условию.',points:1},
 {id:'long',kind:'long',prompt:'Объясни свой переход одним или двумя предложениями.',points:3},
]
export default function QuizRunnerExample(){
 const [selected,setSelected]=useState(0),[answers,setAnswers]=useState<Record<string,Answer>>({}),[preview,setPreview]=useState(false)
 const q=questions[selected],subject=q.id==='code'?'Информатика':'Английский язык'
 return <section aria-label="Экран вопроса теста"><h3>Экран вопроса теста</h3><p>Условные данные. Те же шапка, плашки, варианты и поля, что в настоящем тесте. Ответы остаются только в этом примере.</p>
 <div className="edu-kit-presets" aria-label="Формат вопроса">{['Один вариант','Несколько вариантов','Код Python','Короткий ответ','Объяснение'].map((label,i)=><button key={label} aria-pressed={selected===i} onClick={()=>setSelected(i)}>{label}</button>)}<button aria-pressed={preview} onClick={()=>setPreview(!preview)}>Только чтение</button></div>
 <ThemeFrame subject={subject}><div className="space-y-6"><ThemeHero subject={subject} title="Повторение изученного материала: проверка после перерыва" description="Проверка к3ноября. Уже принятую работу переписывать не нужно." preview={preview}/>
 <QuestionCard question={q} index={selected} answer={answers[q.id]} onAnswer={value=>setAnswers({...answers,[q.id]:value})} subject={subject} disabled={preview}/></div></ThemeFrame>
 </section>
}
