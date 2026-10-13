/** A shared topic belongs to the test context, while differing topics stay with their questions.
 * @see ../../docs/product/quizzes.md#quiz-runner */
export function sharedQuestionTopic(questions: { topic?: string }[]): string | undefined {
  if (questions.length < 2) return undefined
  const topic = questions[0].topic?.trim()
  return topic && questions.every((question) => question.topic?.trim() === topic) ? topic : undefined
}
