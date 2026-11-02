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

it('runs the real no-invite CLI with a fixture HTTP rejection, explicit storage and no credential prompt', async () => {
 const { spawnSync } = await import('node:child_process')
 const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import('node:fs')
 const { tmpdir } = await import('node:os')
 const { join } = await import('node:path')
 const dir = mkdtempSync(join(tmpdir(), 'education-login-fixture-'))
 try {
  writeFileSync(join(dir, 'secret.json'), JSON.stringify({ actorPersonId: 'existing-parent', token: 'previous-connection' }))
  const fixture = `globalThis.fetch=async(url)=>{if(String(url)!=='https://login.mos.ru/sps/oauth/register')throw Error('unexpected endpoint');return Response.json({error:'access_denied',error_description:'The resource owner or authorization server denied the request.'},{status:400,headers:{'x-request-id':'fixture-server-id'}})}`
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(fixture)}`, 'diary/cli.mjs', 'login', '--trace', '--data-dir', dir], { encoding: 'utf8', timeout: 10000 })
  expect(result.status).toBe(1)
  expect(result.stdout).toContain('Инвайт и Firebase не используются')
  expect(result.stdout).toContain('fixture-server-id')
  expect(result.stdout).toContain('"httpStatus": 400')
  expect(result.stdout).toContain('"requestId":')
  expect(result.stdout).toContain('"software_statement":')
  expect(result.stdout).not.toContain('Пароль mos.ru')
  expect(result.stderr).toContain('access_denied')
  expect(JSON.parse(readFileSync(join(dir, 'secret.json'), 'utf8'))).toEqual({ actorPersonId: 'existing-parent', token: 'previous-connection' })
 } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('preserves the current family connection when another valid parent logs in', async () => {
 const save = vi.fn()
 class Adapter { async verifyAccess() { return { accountRole: 'parent' } } }
 await expect(localMeshLogin({ login: async () => ({ actorPersonId: 'different-parent' }), Adapter, save, expectedActorPersonId: 'existing-parent' })).rejects.toThrow('другим родителем')
 expect(save).not.toHaveBeenCalled()
})
