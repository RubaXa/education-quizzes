/** @see ../docs/shared/design/compact-review.md#verification */
import {execFileSync} from 'node:child_process'
import {expect,it} from 'vitest'
it('keeps legacy review hierarchy and valid colours in the actual production build',{timeout:60000},()=>{
 const output=execFileSync(process.execPath,['scripts/check-review-brief-viewport.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:55000,env:{...process.env,REVIEW_BRIEF_SCREENSHOT_DIR:''}})
 expect(output).toContain('"legacyRoles":true')
 expect(output).toContain('"builtColours":true')
})
