import {it,expect} from 'vitest'
import {grade,summarize,countAnswered} from './quiz'
import {quizPassed} from './quizCompletion'
import {quizAnswerCounts} from './quizCardViewModel'
const assignment={schemaVersion:1 as const,testId:'synthetic-scope',title:'Проверка',subject:'Литература',status:'submitted' as const,startedAt:'started',updatedAt:'saved',submittedAt:'sent',questions:[{id:'assigned',kind:'short' as const,prompt:'Названное задание',points:2},{id:'outside',kind:'long' as const,prompt:'Чужая глава',points:3}],answers:{assigned:'верно',outside:'Собственный сохранённый ответ'},authorScopeExclusions:{version:1 as const,revision:1,questionIds:['outside']}}
const key={entries:{assigned:{correct:'верно'},outside:{correct:'Закрытый посторонний ключ'}}}
it('retains an excluded question and its answer without credit, debt, pending review or key disclosure',()=>{
 const result=grade(assignment,key,{entries:{outside:{points:3,explanation:'Старая проверка'}}})
 expect(result).toHaveLength(2);expect(result[1]).toEqual({question:assignment.questions[1],answer:assignment.answers.outside,points:null,excluded:true})
 expect(summarize(result)).toEqual({earned:2,possible:2,pending:0,skipped:0,excluded:1})
 expect(countAnswered(assignment)).toBe(1)
 expect(quizAnswerCounts({token:'synthetic',slug:'synthetic',answered:1,total:1,...assignment,results:result})).toMatchObject({correct:1,excluded:1,incorrect:0,pending:0})
})
it('an entirely excluded attempt grants neither points nor a passing score',()=>{
 const a={...assignment,authorScopeExclusions:{version:1 as const,revision:2,questionIds:['assigned','outside']}}
 const summary=summarize(grade(a,key));expect(summary.earned).toBe(0);expect(summary.possible).toBe(0);expect(summary.pending).toBe(0);expect(quizPassed({points:summary.earned,maxPoints:summary.possible})).toBe(false)
})
