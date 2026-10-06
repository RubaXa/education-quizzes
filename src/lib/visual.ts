import type { QuizVisual } from './quiz'

export type Preset = NonNullable<QuizVisual['preset']>
export type Scene = NonNullable<QuizVisual['scene']>

const presetScenes: Record<Preset, Scene> = {
  english: 'language',
  informatics: 'code',
  biology: 'nature',
  literature: 'story',
  history: 'archive',
  math: 'shapes',
  russian: 'story',
  geography: 'atlas',
  physics: 'lab',
  chemistry: 'lab',
  general: 'shapes',
}

const presetNames: Record<Preset, string> = {
  english: 'Языковая экспедиция',
  informatics: 'Лаборатория кода',
  biology: 'Живая лаборатория',
  literature: 'Литературная мастерская',
  history: 'Архив времени',
  math: 'Мастерская идей',
  russian: 'Мастерская слова',
  geography: 'Атлас открытий',
  physics: 'Физическая лаборатория',
  chemistry: 'Химическая лаборатория',
  general: 'Маршрут знаний',
}

export function resolveVisual(subject: string, visual?: QuizVisual | null): { preset: Preset; scene: Scene; eyebrow: string; caption: string } {
  const name = subject.toLowerCase()
  const inferred: Preset = /англ|english|иностран/.test(name) ? 'english'
    : /информ|программ|технолог/.test(name) ? 'informatics'
      : /биолог|естеств/.test(name) ? 'biology'
        : /литератур|чтен/.test(name) ? 'literature'
          : /истори|обществ/.test(name) ? 'history'
          : /математ|алгебр|геометр/.test(name) ? 'math'
            : /русск|язык/.test(name) ? 'russian'
              : /географ/.test(name) ? 'geography'
                : /физик/.test(name) ? 'physics'
                  : /хими/.test(name) ? 'chemistry'
                    : 'general'
  const preset = visual?.preset && presetScenes[visual.preset] ? visual.preset : inferred
  const scene = visual?.scene && ['city', 'language', 'code', 'nature', 'story', 'archive', 'shapes', 'atlas', 'lab'].includes(visual.scene)
    ? visual.scene : presetScenes[preset]
  return {
    preset,
    scene,
    eyebrow: visual?.eyebrow?.trim() || presetNames[preset],
    caption: visual?.caption?.trim() || 'Каждый вопрос — шаг к пониманию',
  }
}
