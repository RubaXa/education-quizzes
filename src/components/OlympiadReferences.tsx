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

const archives: Record<string, { title: string; file: string; source: string; solutions?: boolean }[]> = {
  'energy-hope-math-2026-2027': [
    ...energyArchive.map(([title, file, source]) => ({ title, file, source })),
    { title: 'Тренировка 2021/22 · 6 класс · условия и решения', file: 'https://yadi.sk/i/vy5yIOCeVZt2vA', source: 'https://www.energy-hope.ru/docs/XXII/EHOPE_XXII_tren_math_solutions_6.pdf', solutions: true },
    { title: 'Методичка комиссии · Мещанинов · 2017', file: 'https://yadi.sk/i/md-LTlNUvN7VOg', source: 'https://www.energy-hope.ru/docs/EHOPE_math_metodic_XVII.pdf', solutions: true },
  ],
  'lomonosov-math-2026-2027': [
    { title: '2025/26 · отбор · 5–10 классы · 5–6 в начале файла', file: 'https://yadi.sk/d/OJuiKjIPqRQ-wA', source: 'https://olymp.msu.ru/rus/page/main/29/page/zadaniya-olimpiady-proshlyh-let', solutions: true },
    { title: '2025/26 · финал · 5–10 классы', file: 'https://yadi.sk/d/eObLyYz_2A4Bsw', source: 'https://olymp.msu.ru/rus/page/main/29/page/zadaniya-olimpiady-proshlyh-let', solutions: true },
    { title: '2024/25 · финал · 5–6 классы', file: 'https://yadi.sk/i/YV_V9NyP_h9_yQ', source: 'https://olymp.msu.ru/rus/page/main/29/page/zadaniya-olimpiady-proshlyh-let', solutions: true },
    { title: 'Официальное пособие МГУ · 2025', file: 'https://yadi.sk/d/yv4bsdGNTpxqxA', source: 'https://olymp.msu.ru/file/static/mainpage/29/Lomonosov_Olympiade_2025.pdf', solutions: true },
  ],
}
export default function OlympiadReferences({ olympiadId, parent = false, context = 'product' }: { olympiadId: string; parent?: boolean; context?: 'product' | 'demo' }) {
  const files = archives[olympiadId] ?? []
  const formulo = olympiadId === 'formulo-math-2026-2027'
  if (!files.length && !formulo) return null
  const opened = (event: React.SyntheticEvent<HTMLDetailsElement>) => { if (event.currentTarget.open) traceOlympiad('detail-opened', context, parent ? 'parent' : 'student') }
  return <section aria-label="Об олимпиаде и материалы">
    <details className="day-practice-variant" onToggle={opened}><summary><strong>Материалы для подготовки · 6 класс</strong></summary>
      {olympiadId === 'energy-hope-math-2026-2027' && <p>Тренировка: 1 и 8 ноября. Отбор: 22 и 28 ноября. Точные часы, предварительный статус и регистрация указаны выше.</p>}
      <p>Начни с задач в разделе «Практика» ниже. Можно загрузить незавершённую попытку: разбор покажет, что уже верно и какой шаг сделать дальше.</p>
      {formulo && <p><a href="https://www.formulo.org/ru/olymp-materials/3/" target="_blank" rel="noopener noreferrer">Архив заданий и решений организатора ↗</a></p>}
      {!parent && files.some(file => file.solutions) && <p>В сборниках есть готовые решения. Родителю доступны полные PDF; условия стартовых задач вынесены ниже отдельно.</p>}
      <ul>{files.filter(file => parent || !file.solutions).map(({ title, file, source }) => <li key={file}><a data-archive-copy href={file} target="_blank" rel="noopener noreferrer">{title} · PDF ↗</a> <a href={source} target="_blank" rel="noopener noreferrer" aria-label={`Оригинал организатора: ${title}`}>Источник ↗</a></li>)}</ul>
      {parent && <p>Полные оригиналы сохранены в общей библиотеке Education. Сезон и номер нужно сверять перед применением авторского ответа. Это архивные материалы, не задания текущего отбора.</p>}
      {olympiadId === 'energy-hope-math-2026-2027' && <p><a href="https://www.energy-hope.ru/olymp/tasks.html" target="_blank" rel="noopener noreferrer">Полный архив организатора ↗</a></p>}
    </details>
  </section>
}
