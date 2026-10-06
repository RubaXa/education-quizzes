import python from '@shikijs/langs/python'
import vitesseDark from '@shikijs/themes/vitesse-dark'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const highlighter = createHighlighterCore({
  langs: [python],
  themes: [vitesseDark],
  engine: createJavaScriptRegexEngine(),
})

export async function highlightPython(code: string): Promise<string> {
  return (await highlighter).codeToHtml(code, { lang: 'python', theme: 'vitesse-dark' })
}
