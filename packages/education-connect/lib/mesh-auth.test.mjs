/** @see ../../../docs/shared/server-runtime.md#авторизация-и-совместимость */
import {afterEach,expect,it,vi} from 'vitest'
import {MeshDiaryAdapter,meshAuthDiagnostic,meshAuthFailure} from './mesh.mjs'
afterEach(()=>vi.unstubAllGlobals())
it.each([401,403])('renews once at role HTTP %s and still verifies parent and child membership',async(status)=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json([{id:'child',person_id:'child-person'}]))
  .mockResolvedValueOnce(new Response('',{status}))
  .mockResolvedValueOnce(Response.json({access_token:'mos'}))
  .mockResolvedValueOnce(Response.json({user_authentication_for_mobile_response:{mesh_access_token:'new'}}))
  .mockResolvedValueOnce(Response.json([]))
  .mockResolvedValueOnce(Response.json([{type:'ParentProfile'}]))
  .mockResolvedValueOnce(Response.json({profile:{type:'parent',id:'parent'},children:[{id:'child'}]}))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'old',actorPersonId:'actor',profileId:'child',clientId:'fixture',clientSecret:'fixture'},save)
 await expect(adapter.verifyAccess()).resolves.toMatchObject({accountRole:'parent',studentLinked:true})
 expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer old')
 expect(fetch.mock.calls[5][1].headers['Auth-Token']).toBe('new')
 expect(save).toHaveBeenLastCalledWith(expect.objectContaining({accountRole:'parent',studentId:'child',token:'new'}))
})
it('never substitutes session renewal for parent authorization',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json([{id:'child',person_id:'child-person'}]))
  .mockResolvedValueOnce(Response.json([{type:'StudentProfile'}]))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'fixture',actorPersonId:'actor',profileId:'child'},save)
 await expect(adapter.verifyAccess()).rejects.toThrow('нужен родительский профиль')
 expect(save).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2)
})
it('reports invalid client safely and stops instead of disguising it as a source outage',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(Response.json({error:'invalid_client',error_description:'private token and identifier'},{status:401}))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(), adapter=new MeshDiaryAdapter({token:'old',clientId:'fixture',clientSecret:'fixture',refreshToken:'refresh'},save)
 let failure;try{await adapter.api.getStudentProfiles('fixture-person')}catch(e){failure=e}
 expect(meshAuthDiagnostic(failure)).toEqual({code:'mesh_auth_required',stage:'oauth-refresh',httpStatus:401,oauthError:'invalid_client'})
 expect(JSON.stringify(failure)).not.toMatch(/private|fixture-person|https/)
 expect(fetch).toHaveBeenCalledTimes(2);expect(save).not.toHaveBeenCalled()
 expect(new URLSearchParams(fetch.mock.calls[1][1].body).get('grant_type')).toBe('client_credentials')
})
it('persists refreshed credentials and retries the original read with the new token',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:401}))
  .mockResolvedValueOnce(Response.json({access_token:'mos',refresh_token:'rotated'}))
  .mockResolvedValueOnce(Response.json({user_authentication_for_mobile_response:{mesh_access_token:'new'}}))
  .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([{id:'fixture'}]))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'old',clientId:'fixture',clientSecret:'fixture',refreshToken:'refresh'},save)
 expect(await adapter.api.getStudentProfiles('fixture-person')).toEqual([{id:'fixture'}])
 expect(save).toHaveBeenCalledWith(expect.objectContaining({token:'new',refreshToken:'rotated'}))
 expect(fetch.mock.calls[4][1].headers['Auth-Token']).toBe('new')
})
it('normalizes SDK authorization errors without retaining response text; leaves network failure independent',()=>{
 expect(meshAuthFailure(new Error('API 403: https://example.com/?token=secret\nprivate body'))).toMatchObject({code:'mesh_auth_required',stage:'mesh-api',httpStatus:403})
 expect(meshAuthFailure(new Error('fetch failed'))).toBeNull()
 expect(meshAuthDiagnostic({code:'mesh_auth_required',stage:'unsafe URL',oauthError:'private body'})).toEqual({code:'mesh_auth_required',stage:'mesh-api',httpStatus:null,oauthError:null})
})

it('falls back to refresh_token only when the linked-client grant cannot renew, and persists the rotation',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:401}))
  .mockResolvedValueOnce(Response.json({error:'access_denied'},{status:400}))
  .mockResolvedValueOnce(Response.json({access_token:'mos',refresh_token:'rotated'}))
  .mockResolvedValueOnce(Response.json({user_authentication_for_mobile_response:{mesh_access_token:'new'}}))
  .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([{id:'fixture'}]))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'old',clientId:'fixture',clientSecret:'fixture',refreshToken:'refresh'},save)
 expect(await adapter.api.getStudentProfiles('fixture-person')).toEqual([{id:'fixture'}])
 expect(fetch.mock.calls.slice(1,3).map(c=>new URLSearchParams(c[1].body).get('grant_type'))).toEqual(['client_credentials','refresh_token'])
 expect(save).toHaveBeenCalledWith(expect.objectContaining({token:'new',refreshToken:'rotated'}))
})
it('does not touch an expired SSO refresh grant when the linked-client grant succeeds',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:401}))
  .mockResolvedValueOnce(Response.json({access_token:'mos'}))
  .mockResolvedValueOnce(Response.json({user_authentication_for_mobile_response:{mesh_access_token:'new'}}))
  .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'old',clientId:'fixture',clientSecret:'fixture',refreshToken:'expired-sso'},save)
 await adapter.api.getStudentProfiles('fixture-person')
 expect(fetch).toHaveBeenCalledTimes(5)
 expect(new URLSearchParams(fetch.mock.calls[1][1].body).get('grant_type')).toBe('client_credentials')
 expect(save).toHaveBeenCalledWith(expect.objectContaining({token:'new',refreshToken:'expired-sso'}))
})

it('keeps a primary provider outage distinct when an expired fallback grant also fails',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:401}))
  .mockResolvedValueOnce(new Response('',{status:503}))
  .mockResolvedValueOnce(Response.json({error:'access_denied'},{status:400}))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'old',clientId:'fixture',clientSecret:'fixture',refreshToken:'expired-sso'},save)
 let failure;try{await adapter.api.getStudentProfiles('fixture-person')}catch(e){failure=e}
 expect(failure.code).toBe('mesh_unavailable');expect(meshAuthDiagnostic(failure)).toBeNull();expect(save).not.toHaveBeenCalled()
})

it('renews an expired web token through its own SSO session without mobile registration or credentials',async()=>{
 const {CookieJar}=await import('tough-cookie')
 const jar=new CookieJar();jar.setCookieSync('sso=fixture; Secure; Path=/','https://login.mos.ru')
 const nextToken='eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({msh:'fixture-parent'})).toString('base64url')+'.fixture'
 let state
 const fetch=vi.fn(async(url,options)=>{
  const u=new URL(url)
  if(u.pathname==='/sps/oauth/ae'){state=u.searchParams.get('state');return new Response('',{status:302,headers:{location:`https://school.mos.ru/v3/auth/sudir/callback?code=fixture&state=${state}`}})}
  if(u.pathname==='/v3/auth/sudir/callback')return new Response('',{status:302,headers:{'set-cookie':`auth_token=${nextToken}; Secure; Path=/`,location:'/diary'}})
  return options.headers['Auth-Token']==='old'?new Response('',{status:401}):Response.json({profile:{type:'parent'}})
 })
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'old',actorPersonId:'fixture-parent',authMethod:'web',webSession:jar.serializeSync()},save)
 expect(await adapter.api.getProfile()).toMatchObject({profile:{type:'parent'}})
 expect(save).toHaveBeenCalledWith(expect.objectContaining({token:nextToken,webSession:expect.objectContaining({cookies:expect.any(Array)})}))
 expect(fetch.mock.calls).toHaveLength(4)
 expect(fetch.mock.calls.every(c=>!c[1].method||c[1].method==='GET')).toBe(true)
})
it('reports expiry of web SSO precisely and never falls back to a mobile client or saved password',async()=>{
 const {CookieJar}=await import('tough-cookie');const jar=new CookieJar()
 const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(Response.json({inquire:'choose_one',items:[{inquire:'login_with_password'}]}))
 vi.stubGlobal('fetch',fetch)
 const save=vi.fn(),adapter=new MeshDiaryAdapter({token:'old',actorPersonId:'fixture-parent',authMethod:'web',webSession:jar.serializeSync()},save)
 let failure;try{await adapter.api.getProfile()}catch(error){failure=error}
 expect(meshAuthDiagnostic(failure)).toMatchObject({code:'mesh_auth_required',stage:'web-session',oauthError:'login_required'})
 expect(fetch).toHaveBeenCalledTimes(2);expect(save).not.toHaveBeenCalled()
})
