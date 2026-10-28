/** Published public reference materials, separated from private family work.
 * @see ../../docs/modules/assessments/olympiad-preparation.md
 */
import { traceOlympiad } from '@/lib/browserAccessTrace'
const energyArchive = [
  ['2025/26 · отборочный этап · вариант 11661', 'https://yadi.sk/i/WLYnFKqW4-6oAg', 'https://www.energy-hope.ru/docs/XXVI/EHOPE_XXVI_preselection_math_tasks_11661.pdf'],
  ['2025/26 · отборочный этап · вариант 12661', 'https://yadi.sk/i/Vs6Iguu6VLLaQQ', 'https://www.energy-hope.ru/docs/XXVI/EHOPE_XXVI_preselection_math_tasks_12661.pdf'],
  ['2025/26 · заключительный этап', 'https://yadi.sk/i/uxjRIhAAQgSU2g', 'https://www.energy-hope.ru/docs/XXVI/EHOPE_XXVI_final_math_tasks_6.pdf'],
  ['2024/25 · отборочный этап · вариант 11661', 'https://yadi.sk/i/rX_zRZpR1lw7uw', 'https://www.energy-hope.ru/docs/XXV/EHOPE_XXV_preselection_math_tasks_11661.pdf'],
  ['2024/25 · отборочный этап · вариант 12661', 'https://yadi.sk/i/eGq9JYu7q0Jo5A', 'https://www.energy-hope.ru/docs/XXV/EHOPE_XXV_preselection_math_tasks_12661.pdf'],
  ['2024/25 · заключительный этап', 'https://yadi.sk/i/2PLrhcZ7wfXgxA', 'https://www.energy-hope.ru/docs/XXV/EHOPE_XXV_final_math_tasks_6.pdf'],
] as const

export default function OlympiadReferences({ olympiadId, parent = false, context = 'product' }: { olympiadId: string; parent?: boolean; context?: 'product' | 'demo' }) {
  if (olympiadId !== 'energy-hope-math-2026-2027') return null
  const opened = (event: React.SyntheticEvent<HTMLDetailsElement>) => { if (event.currentTarget.open) traceOlympiad('detail-opened', context, parent ? 'parent' : 'student') }
  return <section aria-label="Об олимпиаде и материалы">
    <details className="day-practice-variant" onToggle={opened}><summary><strong>Об олимпиаде</strong></summary>
      <p>«Надежда энергетики» — олимпиада школьников. По математике участвуют 5–11 классы. Тренировочный и отборочный этапы проходят дистанционно; заключительный этап — очно.</p>
      <p>Предварительный график 2026/27: тренировка 1 и 8 ноября в 11:00 МСК; математический отбор 22 и 28 ноября в 11:00 МСК. Регистрация на каждый этап открывается отдельно. Даты могут измениться.</p>
      <p><a href="https://www.energy-hope.ru/actual/grafik.html" target="_blank" rel="noopener noreferrer">График организатора ↗</a></p>
    </details>
    <details className="day-practice-variant" onToggle={opened}><summary><strong>Какие задачи встречались</strong></summary>
      <p>В архивных вариантах 6 класса встречаются задачи на логические рассуждения, делимость и цифры, подсчёт вариантов, геометрию на клетках, игры и закономерности. Важно записывать ход рассуждений и объяснять, почему другие случаи учтены.</p>
      <p>Полезно систематически перебирать случаи, искать закономерность, проверять чётность и строить примеры или контрпримеры. Это описание выборки двух прошлых сезонов.</p>
    </details>
    <details className="day-practice-variant" onToggle={opened}><summary><strong>Задания прошлых лет · 6 класс</strong></summary>
      <p>Официальные варианты математики; копии сохранены в общей библиотеке Education. Ответы в этих файлах не размещены.</p>
      <ul>{energyArchive.map(([title, file, source]) => <li key={file}><a data-archive-copy href={file} target="_blank" rel="noopener noreferrer">{title} · PDF ↗</a> <a href={source} target="_blank" rel="noopener noreferrer" aria-label={`Оригинал организатора: ${title}`}>Источник ↗</a></li>)}</ul>
      <p><a href="https://www.energy-hope.ru/olymp/tasks.html" target="_blank" rel="noopener noreferrer">Полный архив организатора ↗</a></p>
    </details>
  </section>
}
