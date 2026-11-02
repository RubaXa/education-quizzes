/** @see ../../../docs/decisions/mesh-web-login-2026-11-02.md */
import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { CookieJar } from 'tough-cookie'
import { authenticateWeb, solveHashcash, validWebSession } from './web-login.mjs'
const state='fixture-state', token=`eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({msh:'fixture-parent'})).toString('base64url')}.fixture`
const authReply=()=>Response.json({inquire:'choose_one',items:[{inquire:'login_with_password',proofOfWork:'1:8:fixture::salt:'}]},{headers:{'set-cookie':'oauth_az=fixture-session; Path=/; Secure; HttpOnly'}})
function fixture({sms=false,badState=false,external=false,denied=false}={}) {
 const calls=[]
 const fetch=vi.fn(async(url,opts)=>{
  calls.push({url:new URL(url),opts})
  const path=new URL(url).pathname
  if(path==='/sps/oauth/ae')return authReply()
  if(path.endsWith('/password')){
   if(denied)return Response.json({errors:[{code:'invalid_credentials'}]})
   if(sms)return Response.json({inquire:'choose_one',items:[{inquire:'ask_to_send_sms'}]})
   return new Response('',{status:302,headers:{location:external?'https://unrelated.test/?code=private':`https://school.mos.ru/v3/auth/sudir/callback?code=fixture-code&state=${badState?'wrong':state}`}})
  }
  if(path.endsWith('/sms/bind')){
   if(!opts.body)return Response.json({inquire:'enter_sms_code'})
   return new Response('',{status:302,headers:{location:`https://school.mos.ru/v3/auth/sudir/callback?code=fixture-code&state=${state}`}})
  }
  if(path==='/v3/auth/sudir/callback')return new Response('',{status:302,headers:{location:'https://school.mos.ru/diary','set-cookie':`auth_token=${token}; Path=/; Secure; HttpOnly`}})
  throw Error('unexpected endpoint')
 })
 return{fetch,calls}
}
it('completes the web password flow with scoped cookies and server callback, without mobile registration',async()=>{
 const f=fixture(),result=await authenticateWeb({...f,username:'fixture-phone',password:'fixture-password',state})
 expect(result).toMatchObject({token,personId:'fixture-parent',authMethod:'web'})
 expect(validWebSession(result.webSession)).toBe(true)
 expect(f.calls.map(x=>x.url.pathname)).toEqual(['/sps/oauth/ae','/sps/login/methods/headless/password','/v3/auth/sudir/callback'])
 expect(f.calls[1].opts.headers.Cookie).toContain('oauth_az=fixture-session')
 expect(f.calls[2].opts.headers.Cookie || '').not.toContain('oauth_az')
 const body=new URLSearchParams(f.calls[1].opts.body)
 expect(body.get('login')).toBe('fixture-phone');expect(body.get('password')).toBe('fixture-password')
 expect(f.calls[1].opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
 expect(createHash('sha1').update(body.get('proofOfWork')).digest()[0]).toBe(0)
})
it('asks for SMS only when the provider requests it, without replaying the password',async()=>{
 const f=fixture({sms:true}),askSmsCode=vi.fn(async()=>'123456')
 await authenticateWeb({...f,username:'fixture-phone',password:'fixture-password',state,askSmsCode})
 expect(askSmsCode).toHaveBeenCalledTimes(1)
 expect(f.calls.filter(x=>x.url.pathname.endsWith('/password'))).toHaveLength(1)
 expect(new URLSearchParams(f.calls[3].opts.body).get('sms-code')).toBe('123456')
})
it('rejects mismatched OAuth state and untrusted redirects before visiting their destinations',async()=>{
 const a=fixture({badState:true}),b=fixture({external:true})
 await expect(authenticateWeb({...a,username:'a',password:'b',state})).rejects.toMatchObject({reason:'state-mismatch'})
 await expect(authenticateWeb({...b,username:'a',password:'b',state})).rejects.toMatchObject({reason:'unexpected-redirect'})
 expect(a.calls).toHaveLength(2);expect(b.calls).toHaveLength(2)
})
it('reports invalid credentials without retry or printing entered values',async()=>{
 const f=fixture({denied:true})
 await expect(authenticateWeb({...f,username:'private-user',password:'private-password',state})).rejects.toMatchObject({providerCode:'invalid_credentials',stage:'password'})
 expect(f.calls).toHaveLength(2)
})
it('does not prompt or post credentials when a saved SSO session requires renewed login',async()=>{
 const jar=new CookieJar();jar.setCookieSync('session=fixture; Secure; Path=/','https://login.mos.ru')
 const fetch=vi.fn(async()=>authReply())
 await expect(authenticateWeb({fetch,session:jar.serializeSync(),interactive:false,state})).rejects.toMatchObject({providerCode:'login_required',reason:'interactive-required'})
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(new URL(fetch.mock.calls[0][0]).searchParams.get('prompt')).toBe('none')
})
it('renews through a saved SSO session with no password, returning rotated cookies',async()=>{
 const jar=new CookieJar();jar.setCookieSync('sso=fixture; Secure; Path=/','https://login.mos.ru')
 const fetch=vi.fn(async(url)=>new URL(url).hostname==='login.mos.ru'
  ?new Response('',{status:302,headers:{location:`https://school.mos.ru/v3/auth/sudir/callback?code=fixture&state=${state}`}})
  :new Response('',{status:302,headers:{'set-cookie':`auth_token=${token}; Secure; Path=/`,location:'/diary'}}))
 const result=await authenticateWeb({fetch,session:jar.serializeSync(),interactive:false,state})
 expect(result.token).toBe(token);expect(fetch).toHaveBeenCalledTimes(2)
 expect(result.webSession.cookies.some(c=>c.key==='auth_token')).toBe(true)
})
it('validates the cookie store host boundary and rejects malformed or oversized proof-of-work',()=>{
 expect(validWebSession({cookies:[{domain:'unrelated.test',key:'sso',value:'fixture'}]})).toBe(false)
 expect(()=>solveHashcash('1:99:fixture')).toThrow()
 expect(()=>solveHashcash('unknown')).toThrow()
})
it('never accepts an old auth cookie when a callback fails to issue a new token',async()=>{
 const jar=new CookieJar();jar.setCookieSync(`auth_token=${token}; Secure; Path=/`,'https://school.mos.ru')
 const fetch=vi.fn(async(url)=>new URL(url).hostname==='login.mos.ru'
  ?new Response('',{status:302,headers:{location:`https://school.mos.ru/v3/auth/sudir/callback?code=fixture&state=${state}`}})
  :new Response('<html>login required</html>',{headers:{'content-type':'text/html'}}))
 await expect(authenticateWeb({fetch,session:jar.serializeSync(),interactive:false,state})).rejects.toMatchObject({providerCode:'login_required'})
})
it('stops at CAPTCHA without solving it or posting credentials',async()=>{
 const fetch=vi.fn(async()=>Response.json({inquire:'captcha'}))
 await expect(authenticateWeb({fetch,username:'fixture',password:'fixture',state})).rejects.toMatchObject({providerCode:'captcha_required'})
 expect(fetch).toHaveBeenCalledTimes(1)
})
