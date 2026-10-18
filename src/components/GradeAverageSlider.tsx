/** @see ../../docs/decisions/grade-average-ui-kit-2026-10-18.md */
/** @see ../../docs/shared/design/ui-kit.md#school-grade-average-slider */
/** @see ../../docs/modules/school-diary/grades.md#grade-badge-slider */
/** @see ../../docs/modules/school-diary/grades.md#grade-badge-slider */
import { useState } from 'react'
import GradeAverage, { gradeAverageTone } from './GradeAverage'
import './GradeAverageSlider.css'

const markers = [200, 300, 400, 450, 460, 500]

function rangeName(average: number, watch: boolean, allFives: boolean) {
  if (allFives) return 'Все отметки в срезе — пятёрки'
  if (watch) return 'Есть подтверждённый сигнал watch'
  if (average < 3) return 'Диапазон двоек · нужна поддержка'
  if (average < 4) return 'Диапазон троек'
  if (average < 4.5) return 'Диапазон четвёрок'
  if (average < 4.6) return 'Уже хорошо'
  return 'Устойчиво высокий средний'
}

export default function GradeAverageSlider() {
  const [hundredths, setHundredths] = useState(450)
  const [watch, setWatch] = useState(false)
  const [allFives, setAllFives] = useState(false)
  const average = hundredths / 100
  const confirmedAllFives = allFives && hundredths === 500
  const tone = gradeAverageTone(average, watch, confirmedAllFives)
  const formatted = average.toFixed(2).replace('.', ',')

  return <section className="edu-grade-slider" aria-labelledby="edu-grade-slider-title">
    <div className="edu-grade-slider-heading"><div><h3 id="edu-grade-slider-title">Динамический пример</h3><p>Перемещайте ползунок: значение и тон метки меняются вместе.</p></div><output htmlFor="edu-grade-slider-input">{formatted}</output></div>
    <GradeAverage value={formatted} tone={tone} excellent={confirmedAllFives} />
    <label className="edu-grade-slider-label" htmlFor="edu-grade-slider-input">Средний балл · от 2,00 до 5,00</label>
    <input id="edu-grade-slider-input" type="range" min="200" max="500" step="1" value={hundredths} aria-valuetext={`${formatted}. ${rangeName(average, watch, confirmedAllFives)}`} onChange={(event) => { setHundredths(Number(event.target.value)); if (Number(event.target.value) !== 500) setAllFives(false) }} />
    <div className="edu-grade-slider-markers" aria-hidden="true">{markers.map((value) => <span key={value} style={{ left: `${(value - 200) / 3}%` }}>{(value / 100).toFixed(value % 100 ? 2 : 0).replace('.', ',')}</span>)}</div>
    <p className="edu-grade-slider-range" aria-live="polite">{rangeName(average, watch, confirmedAllFives)}</p>
    <div className="edu-grade-slider-options">
      <label><input type="checkbox" checked={watch} onChange={(event) => setWatch(event.target.checked)} /> Есть сигнал watch</label>
      <label aria-disabled={hundredths !== 500}><input type="checkbox" checked={confirmedAllFives} disabled={hundredths !== 500} onChange={(event) => setAllFives(event.target.checked)} /> Все оценки — пятёрки</label>
    </div>
    <small>Учебный пример: настройки меняют только демонстрацию и не сохраняют оценку.</small>
  </section>
}
