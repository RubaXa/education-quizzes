/** Conservative extraction of explicitly numbered, individually annotated actions.
 * No inference from commas alone or from an unknown book's contents.
 * @see ../docs/modules/synchronization/plan-generation.md#mixed-actions */
export function mixedEntryActions(entry) {
  const text = String(entry.description ?? '').trim()
  const matches = [...text.matchAll(/упр\.?\s*(\d+)\s*\(([^()]*)\)/gi)]
  if (matches.length < 2 || text.slice(0, matches[0].index).trim()) return [entry]
  const page = text.slice(matches.at(-1).index + matches.at(-1)[0].length).trim()
  if (!/^стр\.?\s*\d+(?:\s*[-–]\s*\d+)?\.?$/i.test(page)) return [entry]
  const modes = matches.map(match => /^\s*(?:пис|письменно)\s*$/i.test(match[2]) ? 'written'
    : /^\s*повторить\s+правило\s*$/i.test(match[2]) ? 'repeat' : null)
  if (modes.some(mode => !mode) || !modes.includes('written') || !modes.includes('repeat')
    || new Set(matches.map(match => match[1])).size !== matches.length) return [entry]
  if (matches.slice(1).some((match, index) => !/^[\s,;]*(?:и\s*)?$/i.test(text.slice(matches[index].index + matches[index][0].length, match.index)))) return [entry]
  return matches.map((match,index) => ({ ...entry, id:`${entry.id}-ex${match[1]}-${modes[index]}`,
    description:`${match[0]} ${page}`, splitOrigin:{ id:`mesh-${entry.id}`, rawText:text, number:match[1], mode:modes[index] } }))
}

export function initialActionRequest(entry) {
  const action = entry.splitOrigin
  if (!action) return {}
  const repeat = action.mode === 'repeat'
  return {
    assessmentIntent:{state:'needs-review'},
    materialRequest:{id:`source-${entry.id}`,state:'open',
      question:repeat
        ? `Пришли фото правила, которое нужно повторить в упражнении ${action.number}, и название книги. После уточнения подготовим тест-самопроверку по этому правилу.`
        : `Пришли фото условия упражнения ${action.number} и название книги, чтобы уточнить письменное задание. Фото выполненной работы пока не требуется.`,
      photoPrompt:repeat ? 'Номер упражнения, полный текст нужного правила и номер страницы. Если правило на другой странице, покажи её тоже.'
        : 'Полное условие указанного упражнения, номер страницы и название учебника или рабочей тетради.'},
  }
}

/** Every child must be a verbatim extracted action, in the original subject. */
export function assertMixedEntry(entry, original, subjectTasks) {
  const actions = mixedEntryActions({id:entry.id.replace(/^mesh-/,''),description:original})
  const ids=actions.map(action=>`mesh-${action.id}`)
  if (actions.length < 2 || entry.rawText !== original || entry.targetTaskId !== ids[0]
    || JSON.stringify(entry.actionIds) !== JSON.stringify(ids)
    || actions.some(action=>!subjectTasks.some(task=>task.id===`mesh-${action.id}` && task.meshText===action.description))) {
    throw new Error(`Разделение ${entry.id} должно сохранять все точные действия и исходную запись МЭШ.`)
  }
  return actions
}
