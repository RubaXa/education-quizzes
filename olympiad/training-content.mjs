/** Server-only authored training bank, never bundle question keys into a client.
 * @see ../docs/research/olympiad-training-content-2026-10-27.md
 * @see ../docs/modules/assessments/olympiad-preparation.md */
import { validateLesson } from './lesson.mjs'

const sources = [
  { title: 'Формула Единства: материалы олимпиад прошлых лет', url: 'https://www.formulo.org/ru/olymp-materials/3/' },
  { title: 'Формула Единства: рекомендации по подготовке', url: 'https://www.formulo.org/ru/math-ru/2026/09/anons-olimpiady-26/' },
]

// These exercises are original, not copies or paraphrases of contest questions.
// Source links describe the organizers' general advice, not origins of examples.
const lessons = [
  {
    id: 'training-enumeration-v1', version: '1', topicId: 'enumeration', title: 'Перебор без пропусков',
    theory: 'Перебор помогает, когда вариантов немного. Выбери порядок записи: сначала закрепи первый выбор, затем выпиши все варианты второго. Проверь, что повторов и пропусков нет. Например, для букв А и Б и цифр 1 и 2 получаются А1, А2, Б1, Б2 — четыре разные пары.',
    steps: [
      { id: 'objects', prompt: 'Пару составляют из одной буквы К или М и одной цифры 1, 2 или 3. Что здесь считается одним вариантом?', options: [{ id: 'a', text: 'Одна буква вместе с одной цифрой' }, { id: 'b', text: 'Только буква' }, { id: 'c', text: 'Любые две цифры' }], correctOptionIds: ['a'], correctExplanation: 'Один вариант — пара: одна выбранная буква и одна выбранная цифра.', incorrectHint: 'Прочитай, из каких двух частей состоит каждый вариант.' },
      { id: 'list', prompt: 'Для буквы К записали К1, К2, К3. Что нужно сделать дальше, чтобы не пропустить варианты?', options: [{ id: 'a', text: 'Записать М1, М2, М3' }, { id: 'b', text: 'Остановиться: цифры уже встречались' }, { id: 'c', text: 'Добавить только М1' }], correctOptionIds: ['a'], correctExplanation: 'Со второй буквой тоже возможна каждая из трёх цифр: М1, М2 и М3.', incorrectHint: 'Для второй буквы проверь каждую разрешённую цифру.' },
      { id: 'count', prompt: 'Сколько получилось разных пар, если для каждой из двух букв есть три цифры?', options: [{ id: 'a', text: '5' }, { id: 'b', text: '6' }, { id: 'c', text: '9' }], correctOptionIds: ['b'], correctExplanation: 'Две непересекающиеся группы по три пары: 3 + 3 = 6, или 2 × 3 = 6.', incorrectHint: 'Посчитай отдельно пары с каждой буквой, затем сложи.' },
    ],
  },
  {
    id: 'training-parity-v1', version: '1', topicId: 'parity', title: 'Чётность и сумма',
    theory: 'Чётное число делится на 2 без остатка, нечётное даёт остаток 1. Сумма двух чётных чисел чётна; чётного и нечётного — нечётна; двух нечётных — чётна. Например, 5 + 7 = 12: две единицы остатка вместе образуют пару.',
    steps: [
      { id: 'classify', prompt: 'Какие остатки при делении на 2 у двух нечётных чисел?', options: [{ id: 'a', text: 'У каждого остаток 1' }, { id: 'b', text: 'У каждого остаток 0' }, { id: 'c', text: 'У одного 0, у другого 1' }], correctOptionIds: ['a'], correctExplanation: 'Каждое нечётное число при делении на 2 даёт остаток 1.', incorrectHint: 'Вспомни определение нечётного числа и рассмотри оба числа по отдельности.' },
      { id: 'sum', prompt: 'Какой может быть сумма двух нечётных целых чисел?', options: [{ id: 'a', text: 'Только чётной' }, { id: 'b', text: 'Только нечётной' }, { id: 'c', text: 'Чётность нельзя определить' }], correctOptionIds: ['a'], correctExplanation: 'Остатки 1 и 1 вместе дают 2, поэтому сумма делится на 2.', incorrectHint: 'Что получается, когда объединить два остатка по единице?' },
      { id: 'apply', prompt: 'Может ли сумма двух нечётных целых чисел равняться 17?', options: [{ id: 'a', text: 'Нет: сумма чётная, а 17 нечётно' }, { id: 'b', text: 'Да: любая сумма возможна' }, { id: 'c', text: 'Нет, потому что 17 меньше 20' }], correctOptionIds: ['a'], correctExplanation: 'Сумма двух нечётных чисел чётна, а 17 нечётно: равенство невозможно.', incorrectHint: 'Сравни чётность суммы и числа 17.' },
    ],
  },
  {
    id: 'training-counterexample-v1', version: '1', topicId: 'counterexample', title: 'Контрпример к общему утверждению',
    theory: 'Чтобы опровергнуть утверждение «все объекты обладают свойством», достаточно найти один объект, который отвечает условию, но не обладает свойством. Такой объект называют контрпримером. Например, утверждение «все чётные числа больше 5» опровергает число 4: оно чётное, но не больше 5.',
    steps: [
      { id: 'goal', prompt: 'Утверждают: «Все числа, которые делятся на 3, нечётные». Что достаточно найти для опровержения?', options: [{ id: 'a', text: 'Одно чётное число, которое делится на 3' }, { id: 'b', text: 'Одно нечётное число, которое делится на 3' }, { id: 'c', text: 'Любое число, которое не делится на 3' }], correctOptionIds: ['a'], correctExplanation: 'Нужен пример, который удовлетворяет условию и нарушает утверждаемое свойство.', incorrectHint: 'Контрпример должен одновременно подходить под условие и нарушать вывод.' },
      { id: 'example', prompt: 'Какое число опровергает утверждение «все числа, делящиеся на 3, нечётные»?', options: [{ id: 'a', text: '6' }, { id: 'b', text: '9' }, { id: 'c', text: '4' }], correctOptionIds: ['a'], correctExplanation: '6 делится на 3 и при этом чётно; значит, утверждение неверно.', incorrectHint: 'Проверь у каждого числа оба условия: деление на 3 и чётность.' },
      { id: 'justify', prompt: 'Как объяснить, почему число 6 подходит как контрпример?', options: [{ id: 'a', text: '6 делится на 3, но чётно' }, { id: 'b', text: '6 меньше 9' }, { id: 'c', text: '6 является натуральным числом' }], correctOptionIds: ['a'], correctExplanation: 'Обоснование проверяет обе части: условие выполняется, а вывод нарушается.', incorrectHint: 'Нужно указать и выполнение условия, и то, почему вывод не выполняется.' },
    ],
  },
// Mathematics and keys are reviewed locally. Availability stays false until
// the required online-quiz authoring and publication gates have been passed.
].map((lesson) => ({ ...lesson, origin: 'author-training', sources, verified: true, available: false }))

for (const lesson of lessons) validateLesson(lesson)

/** Public metadata only; access must still be authorized by the caller. */
export function listTrainingLessons() {
  return lessons.map(({ id, version, topicId, title, theory, sources, origin, verified, available }) => structuredClone({ id, version, topicId, title, theory, sources, origin, verified, available }))
}

/** Trusted-server use only; contains assessment keys. */
export function getTrainingLesson(id) {
  const lesson = lessons.find((item) => item.id === id)
  return lesson ? structuredClone(lesson) : null
}
