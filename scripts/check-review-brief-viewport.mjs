/** @see ../docs/decisions/review-readability-repair-2026-10-31.md */
/** @see ../docs/decisions/compact-review-rollout-2026-10-31.md */
/** Same React/CSS as UI Kit; no second maintained markup.
 * @see ../docs/shared/design/compact-review.md#verification */
/** @see ../docs/decisions/compact-review-ui-kit-2026-10-31.md */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {studentReviewProjection} from '../storage/review-projection.mjs'
import { createServer,build } from 'vite'

const root = resolve(import.meta.dirname, '..')
export async function loadReviewBriefFixture() {
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { default: ReviewBrief } = await vite.ssrLoadModule('/src/components/ReviewBrief.tsx')
    const { default: WorkReview } = await vite.ssrLoadModule('/src/components/WorkReview.tsx')
    const { default: ParentTaskGuide } = await vite.ssrLoadModule('/src/components/ParentTaskGuide.tsx')
    const { solutionGuideExample,solutionVisualExamples } = await vite.ssrLoadModule('/src/lib/solutionExamples.ts')
    const {default:SolutionBlocks}=await vite.ssrLoadModule('/src/components/SolutionBlocks.tsx')
    const { reviewBriefExamples, reviewBriefVerified, reviewBriefUncertain,reviewBriefWorkExample,reviewBriefLegacy } = await vite.ssrLoadModule('/src/lib/reviewBriefExamples.ts')
    const fontRoot = join(root, 'node_modules/@fontsource-variable/geist/files')
    const fonts = ['cyrillic', 'latin'].map(part => `@font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${readFileSync(join(fontRoot, `geist-${part}-wght-normal.woff2`)).toString('base64')}) format('woff2');font-weight:100 900;unicode-range:${part === 'cyrillic' ? 'U+0400-052F,U+2DE0-2DFF,U+A640-A69F' : 'U+0000-00FF'}}`).join('\n')
    const css = fonts + ['src/education-design-tokens.css','src/DayPage.css','src/UiKit.css','src/components/StatusIcon.css','src/components/ReviewBrief.css','src/components/ReviewVisual.css','src/components/ReviewActivity.css','src/components/WorkReview.css'].map(path => readFileSync(join(root, path), 'utf8')).join('\n')
    return { css,fonts,visuals:renderToStaticMarkup(createElement(SolutionBlocks,{blocks:solutionVisualExamples})),guide:solutionGuideExample,renderGuide:(guide=solutionGuideExample)=>renderToStaticMarkup(createElement(ParentTaskGuide,{guide})), examples: reviewBriefExamples, states: [reviewBriefVerified, reviewBriefUncertain], legacy:reviewBriefLegacy, render: data => renderToStaticMarkup(createElement(ReviewBrief, { data })),renderWork:(data,parent=false)=>renderToStaticMarkup(createElement(WorkReview,{review:reviewBriefWorkExample(data),uploads:[],parent})),renderReview:(review,parent=false)=>renderToStaticMarkup(createElement(WorkReview,{review:parent?review:studentReviewProjection(review),uploads:[],parent,canDecide:parent,...(parent?{onDecision:async()=>{}}:{})})) }
  } finally { await vite.close() }
}

async function main() {
  const { chromium } = await import('playwright')
  const executablePath = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path))
  const fixture = await loadReviewBriefFixture()
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const errors = []
  const measured = []
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const doc = (data, enlarged = false,parent=false,theme='light') => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fixture.css}html{color-scheme:light dark}body{margin:0;padding:8px;background:transparent;font-family:'Geist Variable',sans-serif}.specimen{max-width:390px;margin:auto}${enlarged ? '.edu-review-brief{--edu-review-size:32px}' : ''}</style><main class="edu-kit specimen ${theme==='dark'?'dark':''}">${fixture.renderWork(data,parent)}</main>`
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  async function geometry() {
    return page.locator('.edu-review-brief').evaluate(el => ({
      height: Math.round(el.getBoundingClientRect().height), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth || el.scrollWidth > el.clientWidth,
      font: getComputedStyle(el).fontSize, questionFont: el.querySelector('.edu-review-question') ? getComputedStyle(el.querySelector('.edu-review-question')).fontSize : undefined,
      touchHeight: el.querySelector('summary')?.getBoundingClientRect().height,
    }))
  }
  try {
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 540]) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: theme })
      for (const item of [...fixture.examples.map(item => item.data), ...fixture.states]) {
        await page.setContent(doc(item,false,false,theme)); await page.evaluate(() => document.fonts.ready)
        const result = await geometry()
        assert(!result.overflow, `Overflow: ${item.id}/${width}/${theme}`)
        assert(!result.touchHeight || result.touchHeight >= 44, `Small disclosure target: ${item.id}`)
        assert(result.font === '16px', `Unexpected body size: ${item.id}`)
        assert(!result.questionFont || result.questionFont === '18px', `Unexpected question size: ${item.id}`)
        if (width === 390) assert(result.height <= (item.activity?560:320), `Sample exceeds compact budget: ${item.id}: ${result.height}`)
        if (width === 320) assert(result.height <= (item.activity?640:400), `Narrow sample exceeds compact budget: ${item.id}: ${result.height}`)
        if(item.activity){
          assert(await page.locator('.edu-review-question').evaluate(el=>el.getBoundingClientRect().bottom)<320,'Current question below first screen')
          for(const button of await page.locator('.edu-step button').all())assert(await button.evaluate(el=>el.getBoundingClientRect().height)>=44,'Small model control')
        }
        if (width === 390 && theme === 'light') {
          measured.push({ id: item.id, ...result })
          if (process.env.REVIEW_BRIEF_SCREENSHOT_DIR) {
            mkdirSync(process.env.REVIEW_BRIEF_SCREENSHOT_DIR, { recursive: true })
            await page.screenshot({ path: join(process.env.REVIEW_BRIEF_SCREENSHOT_DIR, `${item.id}.png`), fullPage: true })
          }
        }
      }
    }
    // A realistic old document exercises the actual adapter, source/history and
    // parent action. Toy examples alone did not catch the reported regression.
    for(const parent of [false,true])for(const width of [320,390,540]) {
      await page.setViewportSize({width,height:1000})
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${fixture.css}*{box-sizing:border-box}body{margin:0;padding:8px;font-family:'Geist Variable',sans-serif}</style><main class="day-page">${fixture.renderReview(fixture.legacy,parent)}</main>`)
      await page.evaluate(()=>document.fonts.ready)
      assert(!(await geometry()).overflow,`Legacy overflow: ${width}/${parent}`)
      assert(await page.locator('.edu-review-question').isVisible(),'Legacy question hidden')
      assert(await page.locator('.edu-review-question').evaluate(el=>el.getBoundingClientRect().bottom)<320,'Legacy explanation pushes the current question below the compact first level')
      assert(await page.locator('.edu-review-focus').count()===0,'Legacy long paragraph remains expanded')
      assert(await page.locator('details[open]').count()===0,'Legacy disclosures start expanded')
      assert(await page.locator('.day-review-history').count()===1,'Legacy history lost')
      assert(await page.locator('.day-work-review-evidence').count()===(parent?1:0),'Private source crossed roles')
      assert(await page.locator('.day-review-parent-decision button').count()===(parent?1:0),'Parent action changed')
    }
    await page.setViewportSize({ width: 320, height: 1000 })
    const long = { ...fixture.examples[1].data, label: 'Длинный контекст '.repeat(6), focus: 'Дословная запись содержит длинное объяснение. '.repeat(12) }
    for (const item of [long, ...fixture.examples.map(item => item.data)]) {
      await page.setContent(doc(item, true)); await page.evaluate(() => document.fonts.ready)
      assert(!(await geometry()).overflow, `Overflow with enlarged primary text: ${item.id}`)
    }
    await page.setContent(doc(fixture.examples[0].data))
    const detail = page.locator('details').first(); const summary = detail.locator('summary')
    await summary.click(); assert(await detail.evaluate(el => el.open), 'Mouse disclosure failed')
    await summary.focus(); await summary.press('Enter'); assert(!(await detail.evaluate(el => el.open)), 'Enter disclosure failed')
    await summary.press('Space'); assert(await detail.evaluate(el => el.open), 'Space disclosure failed')
    // Test the shipped CSS as well as source styles: compiling light-dark() in
    // custom properties once produced two concatenated colours in production.
    const built=await build({root,configFile:join(root,'vite.config.ts'),logLevel:'silent',build:{write:false}})
    const outputs=(Array.isArray(built)?built:[built]).flatMap(bundle=>bundle.output)
    const compiled=outputs.filter(asset=>asset.type==='asset'&&asset.fileName.endsWith('.css')).map(asset=>String(asset.source)).join('\n')
    assert(compiled.length>0,'Production CSS missing')
    for(const theme of ['light','dark']) {
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${compiled}</style><main class="day-page ${theme==='dark'?'dark':''}"><article class="day-task">${fixture.renderWork(fixture.examples[0].data)}</article></main>`)
      const colours=await page.locator('.edu-review-brief').evaluate(el=>({
        valid:CSS.supports('color',getComputedStyle(el).getPropertyValue('--edu-review-line').trim()),
        border:getComputedStyle(el).borderTopWidth,
        questionBorder:getComputedStyle(el.querySelector('.edu-review-question')).borderLeftWidth,
        modelBorder:getComputedStyle(el.querySelector('.edu-step-result')).borderLeftWidth,
      }))
      assert(colours.valid,`Compiled review colour invalid: ${theme}`)
      assert(colours.border==='1px'&&colours.questionBorder==='2px'&&colours.modelBorder==='2px',`Compiled review hierarchy lost: ${theme}`)
    }
    for(const width of [320,390,540]) {
      await page.setViewportSize({width,height:1000})
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${compiled}${fixture.fonts}</style><main class="page-wrap"><div class="day-page day-parent"><div class="day-subject-list"><section class="day-subject day-subject-math"><div class="day-subject-content"><div class="day-task-list"><article class="day-task">${fixture.renderGuide()}</article></div></div></section></div></div></main>`)
      await page.evaluate(()=>document.fonts.ready)
      await page.locator('.day-parent-guide>.day-learning-route-heading').click()
      assert((await page.locator('.day-learning-route-heading').innerText())==='Ход решения','Repeated parent heading')
      await page.locator('.day-learning-route-stage>summary').nth(1).click()
      assert(await page.locator('math').isVisible(),'Structured equation hidden')
      assert(await page.locator('math').evaluate(el=>el.namespaceURI==='http://www.w3.org/1998/Math/MathML'),'Equation rendered as prose')
      assert(await page.locator('.edu-solution-case-choices button').count()===3,'Cases lost')
      assert(await page.locator('.day-parent-guide').evaluate(el=>el.scrollWidth<=el.clientWidth),'Parent method overflow')
      assert(await page.locator('math').evaluate(el=>el.getBoundingClientRect().width<=el.parentElement.clientWidth),'Equation overflow')
      await page.locator('.day-learning-route-body').nth(1).evaluate((el,html)=>el.insertAdjacentHTML('beforeend',html),fixture.visuals)
      assert(await page.locator('.edu-solution-grid svg').isVisible(),'Grid hidden')
      assert(await page.locator('.edu-solution-graph-node').count()===3,'Graph nodes missing')
      assert(await page.locator('.edu-solution-graph-canvas line').first().evaluate(el=>getComputedStyle(el).stroke!=='none'),'Graph connections missing')
      assert(await page.locator('.day-parent-guide').evaluate(el=>el.scrollWidth<=el.clientWidth),'Visual model overflow')
    }
    assert(!errors.length, errors.join('\n'))
    console.log(JSON.stringify({ samplesAt390: measured, themes: 2, widths: [320, 390, 540], enlargedPrimaryText: true, disclosure: 'mouse/Enter/Space', legacyRoles:true,builtColours:true,methodGuide:true,errors }))
  } finally { await browser.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main()
