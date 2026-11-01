/** @see ../../../docs/shared/server-runtime.md#авторизация-и-совместимость */
import {afterEach,expect,it,vi} from 'vitest'
import {MeshDiaryAdapter,meshAuthDiagnostic,meshAuthFailure} from './mesh.mjs'
afterEach(()=>vi.unstubAllGlobals())
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
