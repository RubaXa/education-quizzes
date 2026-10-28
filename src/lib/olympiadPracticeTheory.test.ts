import { expect, it } from 'vitest'
import { olympiadPracticeTheory } from './olympiadPracticeTheory'
// @ts-expect-error The server-only JavaScript bank has no browser type declarations.
import { listTrainingLessons } from '../../olympiad/training-content.mjs'

it('keeps public reading identical to the reviewed training bank', () => {
  for (const lesson of listTrainingLessons()) {
    expect(olympiadPracticeTheory[lesson.id]).toEqual({ title: lesson.title, theory: lesson.theory })
  }
})
