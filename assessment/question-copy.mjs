/** Shared instructions belong in the test description, not in every question heading.
 * @see ../docs/product/quizzes.md#question-copy */
export function repeatedQuestionCopy(questions) {
  if (questions.length < 3) return []
  const prompts = questions.map((question) => String(question?.prompt ?? '').trim())
  const common = (reversed) => {
    const parts = reversed ? prompts.map((prompt) => [...prompt].reverse()) : prompts.map((prompt) => [...prompt])
    const shortest = Math.min(...parts.map((part) => part.length))
    let count = 0
    while (count < shortest && parts.every((part) => part[count] === parts[0][count])) count += 1
    return (reversed ? parts[0].slice(0, count).reverse() : parts[0].slice(0, count)).join('').trim()
  }
  const prefix = common(false)
  const suffix = common(true)
  const errors = []
  if (prefix.length >= 28 && prefix.split(/\s+/).length >= 4) errors.push('Повторяющееся начало вопросов перенесите в описание теста.')
  if (suffix.length >= 38 && suffix.split(/\s+/).length >= 5) errors.push('Повторяющуюся инструкцию в конце вопросов перенесите в описание теста.')
  return errors
}
