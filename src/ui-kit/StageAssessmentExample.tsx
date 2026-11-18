/** @see ../../docs/modules/school-diary/day-page.md#stage-assessments */
import {useState} from 'react'
import StageAssessment from '@/components/StageAssessment'
import ParentTaskGuide from '@/components/ParentTaskGuide'
import {stageAssessmentResults,stageAssessmentReview} from '@/lib/stageAssessment'
import type {ParentTaskGuide as Guide,DayWorkReview} from '@/lib/dayStore'
const task={stageAssessments:[{stageId:'readiness',title:'Готовность к устному ответу',scope:'Самопроверка по тексту; не запись устной речи.',token:'synthetic-stage-quiz-token'}]}
const guide:Guide={kind:'structured-notes',presentation:'learning-route',overview:'Подготовить ответ по прочитанному тексту.',stages:[{id:'readiness',title:'Готовность к устному ответу',expected:'Ответить на вопросы по тексту в связанном тесте.',source:{kind:'textbook',label:'Учебный пример',ref:'synthetic',excerpt:'Read and answer.'}}]}
const review={id:'synthetic:review',taskId:'example',status:'cannot-assess',checkableStageIds:['readiness'],items:[{stageId:'readiness',label:'Готовность',status:'cannot-assess'}]} as DayWorkReview
export default function StageAssessmentExample(){
 const [passed,setPassed]=useState(false)
 const results=stageAssessmentResults(task,{[task.stageAssessments[0].token]:{status:passed?'submitted':'open',slug:'synthetic'}},passed?{[task.stageAssessments[0].token]:{points:8,maxPoints:9}}:{})
 return <><div className="edu-kit-presets"><button type="button" onClick={()=>setPassed(false)} aria-pressed={!passed}>Ожидает теста</button><button type="button" onClick={()=>setPassed(true)} aria-pressed={passed}>Тест пройден</button></div><div className="edu-decision-roles"><section className="edu-decision-role" aria-label="Родитель · связанный этап"><h4>Родитель</h4><ParentTaskGuide guide={guide} review={stageAssessmentReview(review,results)} stageAssessments={results}/></section><section className="edu-decision-role" aria-label="Ученик · связанный этап"><h4>Ученик</h4><StageAssessment result={results[0]} parent={false} linksEnabled={false}/></section></div></>
}
