/** @see ../../../docs/shared/server-runtime.md#авторизация-и-совместимость */
import {afterEach,expect,it,vi} from 'vitest'
import {createLoginDiagnostics,formatLoginFailure,loginFailure} from './login-diagnostics.mjs'
import {loginToMesh} from './mesh.mjs'
afterEach(()=>vi.unstubAllGlobals())
it('stops at rejected registration before sending username or password and reveals only the safe stage',async()=>{
 const fetch=vi.fn().mockResolvedValue(Response.json({error:'invalid_token',error_description:'private fixture password and token'},{status:401}))
 vi.stubGlobal('fetch',fetch)
 const progress=[]
 let failure;try{await loginToMesh({username:'private-user',password:'private-password',onProgress:m=>progress.push(m)})}catch(e){failure=e}
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(String(fetch.mock.calls[0][1].body)).not.toMatch(/private-user|private-password/)
 expect(failure).toMatchObject({code:'mesh_login_failed',stage:'registration',httpStatus:401,providerCode:'invalid_token'})
 expect(progress).toEqual(['Этап: регистрация приложения…'])
 expect(formatLoginFailure(failure)).toContain('регистрация приложения')
 expect(formatLoginFailure(failure)).not.toMatch(/private|https/)
})
it('reports malformed registration instead of constructing a later request with undefined client credentials',async()=>{
 const d=createLoginDiagnostics(async()=>Response.json({unrelated:'private'}))
 await expect(d.fetch('https://login.mos.ru/sps/oauth/register',{})).rejects.toMatchObject({stage:'registration',reason:'incomplete-registration'})
})
it('distinguishes HTML and network failures, without reflecting the body or URL',async()=>{
 const html=createLoginDiagnostics(async()=>new Response('<html>private</html>',{headers:{'content-type':'text/html'}}))
 await expect(html.fetch('https://login.mos.ru/sps/oauth/ae?private',{})).rejects.toMatchObject({stage:'oauth-init',reason:'non-json-response'})
 const network=createLoginDiagnostics(async()=>{throw Object.assign(Error('private host'),{cause:{code:'ENOTFOUND'}})})
 await expect(network.fetch('https://login.mos.ru/sps/login/methods/headless/password',{})).rejects.toMatchObject({stage:'password',reason:'network',networkCode:'ENOTFOUND'})
})
it('preserves password/SMS redirects and response streams on successful steps',async()=>{
 const d=createLoginDiagnostics(async()=>new Response('',{status:302,headers:{location:'https://example.com/?code=private'}}))
 expect((await d.fetch('https://login.mos.ru/sps/login/methods/headless/password',{})).status).toBe(302)
 expect((await d.fetch('https://login.mos.ru/sps/login/methods/headless/sms/bind',{})).status).toBe(302)
 const ok=createLoginDiagnostics(async()=>Response.json({client_id:'fixture',client_secret:'fixture'}))
 expect(await (await ok.fetch('https://login.mos.ru/sps/oauth/register',{})).json()).toEqual({client_id:'fixture',client_secret:'fixture'})
})
it('never trusts provider or SDK text as a printable diagnostic',()=>{
 const d=createLoginDiagnostics(()=>{})
 expect(formatLoginFailure(d.failure(Error('password=private https://private')))).not.toMatch(/private|https/)
 expect(formatLoginFailure(loginFailure({stage:'private',providerCode:'private',networkCode:'private',reason:'private'}))).not.toContain('private')
 expect(d.failure(Error('Вход прерван')).message).toBe('Вход прерван')
})
