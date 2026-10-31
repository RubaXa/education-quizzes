/** @see ../../docs/modules/reviews/method-guided-solutions.md */
import type {ParentTaskGuide} from './dayStore'
import type {SolutionBlock} from '../../packages/education-presentation/solution-blocks.mjs'
export const solutionVisualExamples:SolutionBlock[]=[
 {kind:'grid',label:'Сетка: выделенная клетка и исключённый угол',rows:4,columns:4,cells:Array.from({length:16},(_,i)=>({row:Math.floor(i/4),column:i%4,mark:i<2?'cut':i===6?'focus':(Math.floor(i/4)+i%4)%2?'first':'second'}))},
 {kind:'graph',label:'Граф: вершины — грани, линии — оставленные склейки',nodes:[{id:'a',label:'Грань A',x:0,y:50},{id:'b',label:'Грань B',x:50,y:50},{id:'c',label:'Грань C',x:100,y:50}],edges:[{from:'a',to:'b'},{from:'b',to:'c'}]},
]
const formula=(label:string,value:string,terms:number[]):SolutionBlock=>({kind:'formula',label,expression:{kind:'row',items:[...terms.flatMap((term,i)=>i?[{kind:'operator' as const,value:'+'},{kind:'number' as const,value:String(term)}]:[{kind:'number' as const,value:String(term)}]),{kind:'operator',value:'='},{kind:'number',value}]}})
const source={kind:'family' as const,label:'Условный пример UI Kit',ref:'demo-method-only',excerpt:'Из предложенных цифр выбери непустой набор.'}
export const solutionGuideExample:ParentTaskGuide={kind:'structured-notes',presentation:'learning-route',pattern:'source-evidence',revision:1,overview:'Тема уже находится снаружи',method:{name:'Полный перебор наборов',reason:'Добавлять разрешены только две цифры, поэтому непустых наборов всего три.',steps:['Перечислить наборы','Проверить сумму','Сравнить варианты']},stages:[
 {id:'assignment',title:'Данные и цель',expected:'К цифрам 1 и 2 можно добавить цифры 3 и 4. Сумма должна делиться на каждую записанную цифру.',source,hintPreview:'Что можно добавить?',revealPreview:'Данные показаны схемой.',blocks:[{kind:'visual',visual:{kind:'facts',label:'Данные условного примера',items:[{label:'На доске',value:'1, 2'},{label:'Можно добавить',value:'3, 4'}]}}]},
 {id:'evidence',title:'Все три случая',expected:'Для каждого набора проверяем сумму всех цифр.',source,hintPreview:'Все ли наборы рассмотрены?',revealPreview:'Конечный перебор показан по случаям.',blocks:[{kind:'cases',label:'Непустые наборы',cases:[
  {label:'Добавить 3',result:'Подходит',blocks:[formula('Общая сумма','6',[1,2,3]),{kind:'text',text:'Полученная сумма делится на каждую из трёх записанных цифр.'}]},
  {label:'Добавить 4',result:'Не подходит',blocks:[formula('Общая сумма','7',[1,2,4]),{kind:'text',text:'Сумма нечётна, поэтому на записанную двойку не делится.'}]},
  {label:'Добавить 3 и 4',result:'Не подходит',blocks:[formula('Общая сумма','10',[1,2,3,4]),{kind:'text',text:'Сумма не делится на все записанные цифры.'}]},
 ]},{kind:'text',title:'Почему перебор полный',text:'Есть два одиночных добавления и одно совместное. Других непустых наборов из этих двух цифр нет.'}]},
]}
