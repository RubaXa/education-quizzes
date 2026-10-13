import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

// @see ../docs/architecture/firestore-read-paths.md#inventory
// This is a source-site inventory, not a claim about billed reads. Dynamic
// helpers, Security Rules lookups and SDK reconnects need runtime measurement.
const root = resolve(import.meta.dirname, '..')
const registryPath = resolve(root, 'docs/architecture/firestore-read-sites.json')
const dirs = ['src', 'scripts', 'sync', 'packages']
const webReads = new Set([
  'getDoc', 'getDocs', 'getDocFromServer', 'getDocsFromServer',
  'getDocFromCache', 'getDocsFromCache', 'getCountFromServer',
  'getAggregateFromServer', 'onSnapshot',
])
const groupFor = (file) => {
  if (file.startsWith('src/')) {
    if (/personalAccess|PersonalEntry|App\.tsx|ConnectionInvite|FamilyAccessCards/.test(file)) return 'client-access'
    if (/familyLibrary|FamilyLibrary|familyBookUpload/.test(file)) return 'client-books'
    if (/dayGuidance|dayDashboardStore|dayStore|parentCompletion/.test(file)) return 'client-day'
    if (/educationStore/.test(file)) return 'client-views-inbox'
    if (/photoOutbox/.test(file)) return 'client-outbox'
    if (/store\.ts$/.test(file)) return 'client-quizzes'
    return 'client-other'
  }
  if (/direct-upload-worker/.test(file)) return 'operator-uploads'
  if (/sync-inbox|sync-queue|sync-project|help-request-cache|job-queue/.test(file)) return 'operator-sync'
  if (/handoff-store/.test(file)) return 'operator-access'
  return 'operator-other'
}

function allFiles(dir) {
  const files = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name === 'dist') continue
    const path = resolve(dir, item.name)
    if (item.isDirectory()) files.push(...allFiles(path))
    else if (/\.(?:ts|tsx|mjs|js)$/.test(item.name) && !/\.(?:test|spec)\.[^.]+$/.test(item.name)) files.push(path)
  }
  return files
}

function scan(filePath, sourceOverride) {
  const file = relative(root, filePath).replaceAll('\\', '/')
  const source = sourceOverride ?? readFileSync(filePath, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  const imported = new Map()
  const mapNames = new Set()
  const sites = []
  let adminContext = false
  function inspect(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'firebase/firestore') {
      if (node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) {
        throw new Error(`Unsupported Firebase namespace import in ${file}; extend the read scanner first.`)
      }
      for (const specifier of node.importClause?.namedBindings?.elements ?? []) {
        imported.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text)
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isNewExpression(node.initializer) && node.initializer.expression.getText(tree) === 'Map') mapNames.add(node.name.text)
    ts.forEachChild(node, inspect)
  }
  inspect(tree)
  adminContext = file.startsWith('scripts/') || file.startsWith('sync/') || file.startsWith('packages/')
  function walk(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      let api = ''
      let target = ''
      if (ts.isIdentifier(callee) && webReads.has(imported.get(callee.text))) {
        api = imported.get(callee.text)
        target = node.arguments[0]?.getText(tree) ?? '?'
      } else if (file.startsWith('src/') && imported.has('runTransaction') &&
        ts.isPropertyAccessExpression(callee) && callee.name.text === 'get' &&
        /^(?:transaction|tx)$/.test(callee.expression.getText(tree))) {
        api = 'transaction.get'
        target = node.arguments[0]?.getText(tree) ?? '?'
      } else if (adminContext && ts.isPropertyAccessExpression(callee) &&
        ['get', 'getAll', 'onSnapshot', 'listDocuments', 'listCollections', 'stream'].includes(callee.name.text)) {
        const receiver = callee.expression.getText(tree)
        const rootName = receiver.match(/^[A-Za-z_$][\w$]*/)?.[0]
        if (!rootName || !mapNames.has(rootName)) {
          // An overinclusive Admin SDK inventory is safer than overlooking a
          // ref.get(). Non-Firestore sites are marked in the checked registry.
          api = `admin.${callee.name.text}`
          target = receiver
        }
      }
      if (api) {
        const normalized = target.replace(/\s+/g, ' ').trim()
        const digest = createHash('sha256').update(`${file}\n${api}\n${normalized}`).digest('hex').slice(0, 12)
        sites.push({ id: `${file}#${api}#${digest}`, file, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
          api, target: normalized, group: groupFor(file) })
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
  const duplicates = new Map()
  return sites.map((site) => {
    const count = duplicates.get(site.id) ?? 0
    duplicates.set(site.id, count + 1)
    return count ? { ...site, id: `${site.id}-${count + 1}` } : site
  })
}

function inventoryProblems(current, saved) {
  const byId = new Map(saved.map((site) => [site.id, site]))
  const seen = new Set(current.map((site) => site.id))
  return {
    missing: current.filter((site) => !byId.has(site.id)),
    stale: saved.filter((site) => !seen.has(site.id)),
    unreviewed: saved.filter((site) => !['justified', 'conditional', 'high-risk', 'excluded'].includes(site.assessment)
      || !site.policy || site.policy === 'review-required' || !site.refresh || site.refresh === 'review-required' || !site.note),
  }
}

if (process.argv.includes('--self-test')) {
  const web = scan(resolve(root, 'src/read-index-fixture.ts'), `
    import { getDoc, onSnapshot, runTransaction } from 'firebase/firestore'
    const cache = new Map()
    getDoc(reference)
    onSnapshot(reference, () => {})
    cache.get('local')
    runTransaction(db, async (transaction) => transaction.get(reference))
  `)
  const admin = scan(resolve(root, 'scripts/read-index-fixture.mjs'), `
    const cache = new Map()
    await db.collection('items').where('active', '==', true).get()
    await db.getAll(one, two)
    cache.get('local')
  `)
  if (web.map((site) => site.api).join(',') !== 'getDoc,onSnapshot,transaction.get'
    || admin.map((site) => site.api).join(',') !== 'admin.get,admin.getAll') {
    throw new Error('Firestore read scanner missed a fixture or counted Map.get().')
  }
  const newRead = inventoryProblems(web, [])
  const undecided = inventoryProblems(web, web)
  if (newRead.missing.length !== 3 || undecided.unreviewed.length !== 3) {
    throw new Error('Firestore read scanner failed to reject new or unclassified reads.')
  }
  let namespaceRejected = false
  try { scan(resolve(root, 'src/read-index-fixture.ts'), "import * as firestore from 'firebase/firestore'") }
  catch { namespaceRejected = true }
  if (!namespaceRejected) throw new Error('Firestore namespace imports must be rejected until indexed.')
  console.log('Firestore read scanner self-test: Web, Admin, transaction, Map exclusion and review gate OK.')
  process.exit(0)
}

const current = dirs.flatMap((dir) => allFiles(resolve(root, dir))).flatMap((file) => scan(file))
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
if (process.argv.includes('--write')) {
  const previous = (() => { try { return JSON.parse(readFileSync(registryPath, 'utf8')) } catch { return [] } })()
  const decisions = new Map(previous.map((site) => [site.id, {
    assessment: site.assessment, policy: site.policy, refresh: site.refresh, note: site.note,
  }]))
  writeFileSync(registryPath, JSON.stringify(current.map((site) => ({ ...site,
    assessment: decisions.get(site.id)?.assessment ?? 'review-required',
    policy: decisions.get(site.id)?.policy ?? 'review-required',
    refresh: decisions.get(site.id)?.refresh ?? 'review-required',
    note: decisions.get(site.id)?.note ?? '',
  })), null, 2) + '\n')
  console.log(`Indexed ${current.length} Firestore candidate read sites. Review every new policy before check.`)
} else {
  const saved = JSON.parse(readFileSync(registryPath, 'utf8'))
  const { missing, stale, unreviewed } = inventoryProblems(current, saved)
  for (const site of missing) console.error(`New Firestore read: ${site.file}:${site.line} ${site.api} ${site.target}`)
  for (const site of stale) console.error(`Stale Firestore read: ${site.file}:${site.line} ${site.api} ${site.target}`)
  for (const site of unreviewed) console.error(`Unreviewed Firestore read: ${site.file}:${site.line} ${site.api}`)
  if (missing.length || stale.length || unreviewed.length) process.exitCode = 1
  else console.log(`Firestore read inventory: ${saved.length} classified source sites; no new calls.`)
}
