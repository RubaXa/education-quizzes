/** Stable, typed operator operations. No caller may provide executable code.
 * @see ../docs/services/operator-cli/README.md#operation-contract */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const date = /^20\d{2}-\d{2}-\d{2}$/
const id = /^[A-Za-z0-9_-]{1,120}$/
const report = /^reports\/20\d{2}-\d{2}-\d{2}-education-sync\/baseline\.md$/
const file = (value) => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')
const none = () => []
const args = (...names) => (input) => names.map((name) => input[name])
const fields = (shape) => (input) => {
  const errors = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['input must be an object']
  for (const [name, valid] of Object.entries(shape)) if (!valid(input[name])) errors.push(`invalid input.${name}`)
  for (const name of Object.keys(input)) if (!(name in shape)) errors.push(`unknown input.${name}`)
  return errors
}

export const operations = Object.freeze({
  'project.plan': { effect: 'read', script: 'scripts/sync-project.mjs', command: 'plan', validate: fields({}), argv: none },
  'project.collect': { effect: 'write', script: 'scripts/sync-project.mjs', command: 'collect', validate: fields({}), argv: none },
  'project.audit': { effect: 'read', script: 'scripts/sync-project.mjs', command: 'audit',
    validate: fields({ runId: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/.test(v) }),
    argv: (input) => ['--run', input.runId] },
  'inbox.snapshot': { effect: 'read', script: 'scripts/sync-inbox.mjs', validate: fields({}), argv: none },
  'queue.list': { effect: 'read', script: 'scripts/sync-queue.mjs', command: 'list', validate: fields({}), argv: none },
  'queue.scan': { effect: 'write', script: 'scripts/sync-queue.mjs', command: 'scan', validate: fields({}), argv: none },
  'grades.snapshot': { effect: 'reconcile', script: 'scripts/grade-snapshot.mjs',
    validate: fields({ sourceDate: (v) => date.test(v), reportPath: (v) => report.test(v) }),
    argv: (input, apply) => [...args('sourceDate', 'reportPath')(input), ...(apply ? ['--apply'] : [])] },
  'grades.publish': { effect: 'reconcile', script: 'scripts/day.mjs', command: 'reconcile-grades',
    validate: fields({}), argv: (_input, apply) => apply ? ['--apply'] : [] },
  'calendar.publish': { effect: 'write', script: 'scripts/day.mjs', command: 'dashboard', validate: fields({}), argv: none },
  'day.audit': { effect: 'read', script: 'scripts/day.mjs', command: 'audit', validate: fields({}), argv: none },
  'quiz.validate': { effect: 'read', script: 'scripts/quiz.mjs', command: 'validate',
    validate: fields({ specPath: file }), argv: args('specPath') },
  'quiz.publish': { effect: 'create', script: 'scripts/quiz.mjs', command: 'create', preflight: 'validate',
    validate: fields({ specPath: file, personId: (v) => typeof v === 'string' && id.test(v) }), argv: args('specPath', 'personId'), payloadField: 'specPath' },
  'quiz.revise-open': { effect: 'create', script: 'scripts/quiz.mjs', command: 'revise-open', preflight: 'validate',
    validate: fields({ learnerToken: (v) => typeof v === 'string' && id.test(v), specPath: file,
      personId: (v) => typeof v === 'string' && id.test(v) }),
    argv: args('learnerToken', 'specPath', 'personId'), payloadField: 'specPath' },
  'review.validate': { effect: 'read', script: 'scripts/submissions.mjs', command: 'validate',
    validate: fields({ reviewPath: file }), argv: args('reviewPath') },
  'review.publish': { effect: 'create', script: 'scripts/submissions.mjs', command: 'review', preflight: 'validate',
    validate: fields({ reviewPath: file }), argv: args('reviewPath'), payloadField: 'reviewPath' },
})

export function validateOperationRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.schemaVersion !== 1) {
    throw new Error('OperationRequest requires schemaVersion 1.')
  }
  if (Object.keys(request).some((name) => !['schemaVersion', 'operation', 'input'].includes(name))) {
    throw new Error('OperationRequest contains unknown fields.')
  }
  const operation = operations[request.operation]
  if (!operation) throw new Error(`Unknown operation: ${request.operation}`)
  const errors = operation.validate(request.input)
  if (errors.length) throw new Error(errors.join('; '))
  return operation
}

export function operationCommand(request, apply) {
  const operation = validateOperationRequest(request)
  if (!apply && ['write', 'create'].includes(operation.effect)) throw new Error(`${request.operation} requires --apply.`)
  return { script: operation.script, argv: [...(operation.command ? [operation.command] : []), ...operation.argv(request.input, apply)] }
}

export function operationFingerprint(request, root) {
  const operation = validateOperationRequest(request)
  const payloadPath = operation.payloadField ? resolve(root, request.input[operation.payloadField]) : null
  const payload = payloadPath ? readFileSync(payloadPath) : Buffer.alloc(0)
  const plan = ['quiz.publish', 'quiz.revise-open'].includes(request.operation)
    ? JSON.parse(payload.toString('utf8')).assessmentPlanPath : null
  const planBytes = plan ? readFileSync(resolve(dirname(payloadPath), plan)) : Buffer.alloc(0)
  return createHash('sha256').update(JSON.stringify([request.schemaVersion, request.operation, request.input,
    payload.toString('base64'), planBytes.toString('base64')])).digest('hex')
}

export function operationCatalog() {
  return Object.entries(operations).map(([id, value]) => ({ id, effect: value.effect,
    input: Object.keys(sampleFields[id] ?? {}), purpose: guidance[id][0], interpretation: guidance[id][1] }))
}

// Operational meaning belongs next to the registry; pedagogical decisions stay in the decision graph.
const guidance = {
  'project.plan': ['Обнаружить все семьи, детей и доступы МЭШ.', 'queued — цели сбора, blocked — конкретные отсутствующие доступы; это ещё не проверка источников.'],
  'project.collect': ['Собрать МЭШ за 42 даты от текущего понедельника.', 'report и timing описывают сбор; awaiting-enrichment требует сверки новых материалов. partial не означает успешное завершение; sourceJournal содержит причины.'],
  'project.audit': ['Перечитать публикацию сохранённого окна конкретного запуска.', 'Проверяет публикацию без сбора и изменения очереди или фазы. publication-verified не означает завершение workflow или снятие блокировки источника; pending/blocked требуют продолжения.'],
  'inbox.snapshot': ['Получить полный пользовательский inbox всех семей.', 'Только complete=true разрешает трактовать нулевые counts как пустую очередь; ошибка чтения не равна отсутствию работ.'],
  'queue.list': ['Прочитать сохранённые задания операторской очереди.', 'Это сохранённое состояние, без нового обнаружения источников; blocked требует чтения причины в закрытой квитанции.'],
  'queue.scan': ['Обновить очередь из полного inbox и подтверждённых источников.', 'summary.inbox.complete должен быть true; полный inboxSnapshot находится в закрытом stdout квитанции. created/resolved не являются числом опубликованных учебных результатов.'],
  'grades.snapshot': ['Сверить числовой срез оценок локального профиля.', 'Без --apply это предпросмотр; неизменный срез не записывается. Семейный контекст ограничен действующим локальным профилем.'],
  'grades.publish': ['Сверить проекции оценок опубликованных дней.', 'Без --apply это предпросмотр; verified подтверждает обратную сверку, changed — число обновлений.'],
  'calendar.publish': ['Обновить ролевые индексы опубликованных дней.', 'Индекс не обнаруживает новые даты МЭШ; после записи проверь day.audit.'],
  'day.audit': ['Сравнить опубликованные дни и ссылки обеих ролей с источником.', 'verified=true только при полном аудите без problems; checkedDates — охват, measurements — SDK-вызовы, не оплаченные reads.'],
  'quiz.validate': ['Проверить модель теста и учебный план перед записью.', 'Успешная валидация не доказывает правильность педагогического ключа; смысловая сверка источника остаётся обязательной.'],
  'quiz.publish': ['Опубликовать проверенный тест и связанные ролевые индексы.', 'published/readback подтверждают встроенную обратную сверку; reused относится к прошлой публикации того же пакета, а не к свежему чтению. Ссылки — в закрытой квитанции.'],
  'quiz.revise-open': ['Исправить только ещё не начатую попытку, сохранив ссылку.', 'verified подтверждает обратную сверку; начатый тест менять нельзя. reused требует отдельного чтения для утверждения текущего состояния.'],
  'review.validate': ['Проверить структурированный пакет разбора до записи.', 'Валидатор проверяет модель, источники и состояния; предметный вывод требует анализа оригиналов и второго прохода при сомнении.'],
  'review.publish': ['Опубликовать разбор и статусы связанных фото.', 'verified требует адресного readback; неопределённый исход записи требует сверки, а не слепого повтора.'],
}

const sampleFields = {
  'project.audit': { runId: 1 },
  'grades.snapshot': { sourceDate: 1, reportPath: 1 },
  'quiz.validate': { specPath: 1 }, 'quiz.publish': { specPath: 1, personId: 1 },
  'quiz.revise-open': { learnerToken: 1, specPath: 1, personId: 1 },
  'review.validate': { reviewPath: 1 }, 'review.publish': { reviewPath: 1 },
}
