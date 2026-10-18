import { resolve } from 'node:path'
import { createEducationFirestore } from '../../packages/education-runtime/firestore.mjs'

/** Local operator compatibility wrapper. Server Firestore/ADC setup lives in education-runtime.
 * @see ../../docs/shared/server-runtime.md#границы-и-порты
 * @see ../../docs/modules/families/README.md#provisioning
 */
export function operatorFirestore(options = {}) {
  return createEducationFirestore({ projectId: options.projectId ?? 'education-9d7c6',
    cwd: options.cwd ?? resolve('.'), ...options })
}
