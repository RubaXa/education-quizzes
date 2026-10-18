/** Read-only collector for an existing tab, including pre-LDD builds.
 * No network/storage writes or authentication changes.
 * @see ../docs/modules/families/browser-access-trace.md */
export async function collectBrowserAccessSnapshot() {
  const fingerprint = async (value) => typeof value === 'string'
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24) : null
  let cached
  try { cached = JSON.parse(localStorage.getItem('education-personal-context-v1') || 'null') } catch { /* Missing/blocked cache is evidence, not student access. */ }
  const roles = Array.isArray(cached?.profile?.children) ? [...new Set(cached.profile.children.map(child => child.role).filter(role => role === 'parent' || role === 'student'))] : []
  const routeName = location.hash.split('/')[1] || 'home'
  const route = ['home', 'enter', 'day', 'day-parent', 'days', 'days-parent', 'my', 'review', 'dashboard', 't', 'preview', 'connect', 'ui-kit'].includes(routeName) ? routeName : 'unknown'
  const baseline = {
    route, roles, person: await fingerprint(cached?.session?.personId), device: await fingerprint(cached?.session?.deviceUid),
    sessionProfileMatch: Boolean(cached?.session?.personId && cached.session.personId === cached?.profile?.personId),
    savedAt: Number.isFinite(cached?.savedAt) ? cached.savedAt : null,
    bundles: [...document.scripts].map(script => script.src.split('/').pop()).filter(file => /^index-[A-Za-z0-9_-]{1,64}\.js$/.test(file)),
    parentGuide: Boolean(document.querySelector('.day-parent-guide')),
    studentUpload: [...document.querySelectorAll('button')].some(button => /Добавить фото (решения|исправления)/.test(button.textContent || '')),
    online: navigator.onLine, standalone: Boolean(navigator.standalone || window.matchMedia('(display-mode: standalone)').matches),
  }
  const trace = window.educationDiagnostics?.export ? JSON.parse(await window.educationDiagnostics.export()) : { schemaVersion: 1, events: [] }
  return JSON.stringify({ ...trace, baseline }, null, 2)
}
