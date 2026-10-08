function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

const sections = {
  schedule: {
    key: (item) => String(item.id),
    value: (item) => ({ start_at: item.start_at, finish_at: item.finish_at, subject_id: item.subject_id, subject_name: item.subject_name, cancelled: item.cancelled, replaced: item.replaced, homework: item.homework, marks: item.marks }),
  },
  marks: {
    key: (item) => `${item.subject_id}:${item.period ?? ''}`,
    value: (item) => ({ average: item.average, count: item.count, target: item.target, marks: item.marks, fixed_value: item.fixed_value, period: item.period }),
  },
  assignments: {
    key: (item) => item.sourceItemId,
    value: (item) => ({ lessonDate: item.lessonDate, descriptions: item.descriptions, materialCounts: item.materialCounts, homeworkEntries: item.homeworkEntries, teacherFiles: item.teacherFiles, detailStatus: item.detailStatus }),
  },
}

export function diffSnapshots(previous, current) {
  if (!previous) return { baseline: true, previousFetchedAt: null, sections: {} }
  const result = { baseline: false, previousFetchedAt: previous.fetchedAt, sections: {} }
  for (const [name, config] of Object.entries(sections)) {
    if (!Array.isArray(previous[name]) || !Array.isArray(current[name])) {
      result.sections[name] = { comparable: false }
      continue
    }
    const before = new Map(previous[name].map((item) => [config.key(item), JSON.stringify(canonical(config.value(item)))]))
    const after = new Map(current[name].map((item) => [config.key(item), JSON.stringify(canonical(config.value(item)))]))
    const added = [...after.keys()].filter((key) => !before.has(key))
    const removed = [...before.keys()].filter((key) => !after.has(key))
    const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key))
    result.sections[name] = { comparable: true, added, removed, changed }
  }
  return result
}
