/** @see ../docs/decisions/mesh-http-trace-2026-11-02.md */
import { expect, it, vi } from 'vitest'
import { localMeshLogin } from './login.mjs'
it('does not overwrite an existing connection when family/role verification fails', async () => {
 const save = vi.fn(), failure = Error('verification failed')
 class Adapter { async verifyAccess() { throw failure } }
 await expect(localMeshLogin({ login: async () => ({ token: 'new-private', profileName: 'fixture' }), Adapter, save })).rejects.toBe(failure)
 expect(save).not.toHaveBeenCalled()
})
it('persists only the fully verified credential update, never the profile display name', async () => {
 const save = vi.fn()
 class Adapter { constructor(c, update) { this.update = update } async verifyAccess() { this.update({ token: 'verified-private', verifiedAt: 'fixture' }); return { accountRole: 'parent' } } }
 await expect(localMeshLogin({ login: async () => ({ token: 'new-private', profileName: 'fixture' }), Adapter, save })).resolves.toMatchObject({ profileName: 'fixture', verified: { accountRole: 'parent' } })
 expect(save).toHaveBeenCalledWith({ token: 'verified-private', verifiedAt: 'fixture' })
})

it('preserves the current family connection when another valid parent logs in', async () => {
 const save = vi.fn()
 class Adapter { async verifyAccess() { return { accountRole: 'parent' } } }
 await expect(localMeshLogin({ login: async () => ({ actorPersonId: 'different-parent' }), Adapter, save, expectedActorPersonId: 'existing-parent' })).rejects.toThrow('другим родителем')
 expect(save).not.toHaveBeenCalled()
})

it('reads credentials before invoking the chosen login driver',async()=>{
 const order=[],login=vi.fn(async input=>{order.push('login');expect(input).toMatchObject({username:'fixture-phone',password:'fixture-password',method:'web'});return {token:'fixture'}})
 class Adapter{async verifyAccess(){return{accountRole:'parent'}}}
 await localMeshLogin({login,Adapter,readCredentials:async()=>{order.push('credentials');return{username:'fixture-phone',password:'fixture-password'}},save:()=>{}})
 expect(order).toEqual(['credentials','login'])
})
