/** @see ../docs/shared/design/information-hierarchy.md */
import{execFileSync}from'node:child_process'
import{it,expect}from'vitest'
it('keeps real catalog overviews readable in the production build',{timeout:60000},()=>{
 const out=execFileSync(process.execPath,['scripts/check-olympiad-overview-viewport.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:55000,env:{...process.env,OLYMPIAD_SCREENSHOT_DIR:''}})
 expect(out).toContain('"catalog":19');expect(out).toContain('"builtCss":true');expect(out).toContain('"errors":[]')
})
