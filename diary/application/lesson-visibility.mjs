import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const policyFile = resolve('.local/diary/lesson-visibility.json')

function hiddenSubjects() {
  if (!existsSync(policyFile)) return new Map()
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'))
  return new Map((policy.notConducted || []).map(({ subject, evidence }) => [String(subject).replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru'), evidence]))
}

function subjectName(lesson) {
  const value = lesson?.subject_name ?? lesson?.subjectName ?? lesson?.subject?.name ?? ''
  return String(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')
}

/** @see ../../docs/architecture/school-diary-port-adapter.md#visibility */
export function lessonVisibility(schedule) {
  if (!Array.isArray(schedule)) return { conducted: null, hidden: [] }
  const notConducted = hiddenSubjects()
  const conducted = []
  const hidden = []
  for (const lesson of schedule) {
    const eventId = notConducted.get(subjectName(lesson))
    if (eventId) hidden.push({ lesson, reason: 'not-conducted', evidence: eventId })
    else conducted.push(lesson)
  }
  return { conducted, hidden }
}
