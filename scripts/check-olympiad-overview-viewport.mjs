/** @see ../docs/shared/design/information-hierarchy.md */
import{existsSync,mkdirSync,readFileSync}from'node:fs'
import{join,resolve}from'node:path'
import{createElement}from'react'
import{renderToStaticMarkup}from'react-dom/server'
import{build,createServer}from'vite'
import{chromium}from'playwright'
import{seasonCalendarCatalog}from'../olympiad/season-calendar.mjs'
const root=resolve(import.meta.dirname,'..')
async function main(){
 const vite=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom'});let Overview,Back,NextStep
 try{({default:Overview,OlympiadBackLink:Back}=await vite.ssrLoadModule('/src/components/OlympiadOverview.tsx'));({default:NextStep}=await vite.ssrLoadModule('/src/components/OlympiadNextStep.tsx'))}finally{await vite.close()}
 const result=await build({root,logLevel:'silent',build:{write:false}}),outputs=(Array.isArray(result)?result:[result]).flatMap(r=>r.output)
 const css=outputs.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>String(a.source)).join('\n')
 const fonts=['latin','cyrillic'].map(part=>`@font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${readFileSync(join(root,`node_modules/@fontsource-variable/geist/files/geist-${part}-wght-normal.woff2`)).toString('base64')}) format('woff2');font-weight:100 900}`).join('')
 const browser=await chromium.launch({headless:true,executablePath:[process.env.CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p))})
 const page=await browser.newPage(),errors=[],sizes=[];page.on('pageerror',e=>errors.push(e.message));const assert=(value,msg)=>{if(!value)throw new Error(msg)}
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-31T15:00:00Z')
 const render=item=>renderToStaticMarkup(createElement('main',{className:'page-wrap'},createElement('section',{className:'olympiad-page'},createElement(Back,{href:'#/days/demo'}),createElement('div',{className:'day-dashboard-card olympiad-page-body'},createElement(Overview,{olympiad:item,nextStep:createElement(NextStep,{next:{taskId:'next',title:'№4 · Продолжение рассуждения',reason:'Закончить один переход, сохранив уже принятые части.',evidenceIds:[]},availableTaskIds:['next'],onOpenTask:()=>{},heading:'Что сделать сейчас',prominent:true}),sections:[{id:'personal',label:'Моя подготовка'},{id:'practice',label:'Практика',count:7},{id:'tests',label:'Тесты'},{id:'history',label:'Мои участия'}]})))))
 const catalog=seasonCalendarCatalog(),dir=process.env.OLYMPIAD_SCREENSHOT_DIR
 try{for(const width of [320,390,540,1024]){
  await page.setViewportSize({width,height:1000})
  for(const item of catalog){
   await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}${fonts}</style>${render(item)}`);await page.evaluate(()=>document.fonts.ready)
   const m=await page.locator('.olympiad-overview').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth||document.documentElement.scrollWidth>innerWidth,height:el.getBoundingClientRect().height,title:getComputedStyle(el.querySelector('h1')).fontSize,body:getComputedStyle(el.querySelector('.olympiad-preparation-next p:nth-of-type(2)')).fontSize,button:el.querySelector('.olympiad-preparation-next button').getBoundingClientRect().height,actionBottom:el.querySelector('.olympiad-preparation-next button').getBoundingClientRect().bottom}))
   assert(m.actionBottom+100<740,'Next action below the first mobile screen, including room for the app header');assert(!await page.locator('.olympiad-registration').isVisible(),'Registration competes with the next step');
   assert(!m.overflow,`${item.id}/${width}: overflow`);assert(m.body==='16px',`${item.id}/${width}: body ${m.body}`);assert(m.title===(width<=540?'24px':'28px'),`${item.id}: title hierarchy lost`);assert(m.button>=44,'Small action target')
   assert(await page.locator('details[open]').count()===0,'Details open by default')
   if(item.id.startsWith('formulo')){
    sizes.push({width,height:Math.round(m.height)})
    if([320,390].includes(width)&&dir){mkdirSync(dir,{recursive:true});await page.locator('.olympiad-page').screenshot({path:join(dir,`formulo-${width}.png`)})}
    await page.locator('details>summary').first().click();assert(await page.getByText('Каждая задача отправляется отдельным файлом', {exact:false}).isVisible(),'Rules unavailable');assert(await page.locator('.olympiad-registration').isVisible(),'Organizer link unavailable');assert((await page.locator('.olympiad-overview').textContent()).split(item.calendar.registrationNote).length===2,'Registration note repeated')
    await page.locator('details>summary').first().press('Enter');assert(await page.locator('details[open]').count()===0,'Keyboard close failed')
    await page.locator('details>summary').nth(1).press('Space');assert(await page.getByText('Продолжи свои задачи и тесты ниже', {exact:false}).isVisible(),'Plan unavailable')
   }
  }
 }
 await page.setViewportSize({width:390,height:1000});await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}${fonts}.olympiad-overview p{font-size:32px!important}</style>${render(catalog[0])}`);assert(await page.locator('.olympiad-overview').evaluate(el=>el.scrollWidth<=el.clientWidth),'Enlarged text overflow');
 assert(errors.length===0,errors.join('\n'));console.log(JSON.stringify({catalog:catalog.length,widths:[320,390,540,1024],builtCss:true,nextStepFirst:true,sizes,errors}))
 }finally{Date.now=originalNow;await browser.close()}
}
await main()
