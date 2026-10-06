import { useEffect, useState } from 'react'

export function CodeBlock({ code }: { code: string }) {
  const [highlighted, setHighlighted] = useState<{ code: string; html: string }>()

  useEffect(() => {
    let active = true
    void import('@/lib/highlight')
      .then(({ highlightPython }) => highlightPython(code))
      .then((html) => {
        if (active) setHighlighted({ code, html })
      })
      .catch(() => {
        // The plain-text listing remains readable if highlighting cannot load.
      })
    return () => { active = false }
  }, [code])

  return (
    <div className="code-frame" role="region" aria-label="Код программы на Python">
      <div className="code-caption"><span className="code-dot" /> Код программы · Python</div>
      {highlighted?.code === code ? (
        <div className="highlighted-code" dangerouslySetInnerHTML={{ __html: highlighted.html }} />
      ) : (
        <pre className="question-code"><code>{code}</code></pre>
      )}
    </div>
  )
}
