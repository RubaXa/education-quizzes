/** @see ../../../docs/decisions/mesh-http-trace-2026-11-02.md */
import { expect, it, vi } from 'vitest'
import { createHttpTrace, maskSecret } from './http-trace.mjs'
it('shows two characters and length, never the remainder or an entire short secret', () => {
 expect(maskSecret('abcdef')).toBe('ab******** (длина: 6)')
 expect(maskSecret('abc')).toBe('******** (длина: 3)')
 expect(maskSecret('😀абвг')).toBe('😀а******** (длина: 5)')
})
it('correlates requests, preserves server request IDs and masks credentials in every HTTP channel', async () => {
 const events = [], response = Response.json({ error: 'access_denied', error_description: 'The resource owner or authorization server denied the request.', access_token: 'response-secret', nested: { person_id: 'private-person' } }, { status: 400, headers: { 'x-request-id': 'server-fixture-id', 'set-cookie': 'cookie-private-secret', location: 'https://school.mos.ru/callback?code=private-code' } })
 const fetcher = vi.fn(async () => response)
 const t = createHttpTrace(fetcher, { write: x => events.push(JSON.parse(x)), id: () => 'trace-fixture', now: () => 10 })
 const opts = { method: 'POST', headers: { Authorization: 'Bearer request-secret', Cookie: 'private-cookie', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'password-private', login: 'login-private', software_id: 'dnevnik.mos.ru', software_statement: 'statement-private' }) }
 const result = await t.fetch('https://login.mos.ru/sps/oauth/te?refresh_token=refresh-private', opts)
 expect(fetcher).toHaveBeenCalledWith('https://login.mos.ru/sps/oauth/te?refresh_token=refresh-private', opts)
 expect(result).toBe(response); expect((await result.json()).access_token).toBe('response-secret')
 expect(events.map(e => e.requestId)).toEqual(['trace-fixture:1', 'trace-fixture:1'])
 expect(events[1].headers['x-request-id']).toBe('server-fixture-id')
 expect(events[1].body.json.error_description).toContain('denied the request')
 const log = JSON.stringify(events)
 for (const secret of ['request-secret','private-cookie','password-private','login-private','statement-private','refresh-private','response-secret','private-person','cookie-private-secret','private-code']) expect(log).not.toContain(secret)
 expect(events[0].body.json.software_statement).toBe('st******** (длина: 17)')
})
it('keeps non-JSON errors, form/query structure and network failure correlation without exposing values', async () => {
 const logs = [], failure = Object.assign(Error('private-network-message'), { cause: { code: 'ECONNRESET' } })
 const t = createHttpTrace(async () => { throw failure }, { write: x => logs.push(JSON.parse(x)), id: () => 'fixture' })
 await expect(t.fetch('https://login.mos.ru/sps/oauth/te', { body: new URLSearchParams({ code: 'private-code', code_verifier: 'private-verifier', grant_type: 'authorization_code' }) })).rejects.toBe(failure)
 expect(logs[0].body.form).toContainEqual(['grant_type', 'authorization_code'])
 expect(logs[1].direction).toBe('network-error')
 expect(JSON.stringify(logs)).not.toMatch(/private-code|private-verifier|private-network-message/)
})
it('does not consume the original response or let a broken output sink fail authentication', async () => {
 const response = new Response('private-html', { status: 500 })
 const t = createHttpTrace(async () => response, { write: () => { throw Error('sink') } })
 expect(await (await t.fetch('https://login.mos.ru')).text()).toBe('private-html')
})
it('prints stack frame locations without copying the error message or URL query', async () => {
 const { traceStack } = await import('./http-trace.mjs')
 const error = Error('private-password-and-token')
 error.stack = 'Error: private-password-and-token\n    at fetch (file:///fixture/code.mjs?token=secret:2:3)\n    at next (file:///fixture/next.mjs:5:6)'
 expect(traceStack(error)).toEqual(['    at fetch (file:///fixture/code.mjs?[masked])', '    at next (file:///fixture/next.mjs:5:6)'])
})
it('caps response inspection and preserves a large original body', async () => {
 const raw = 'x'.repeat(70000), logs = []
 const t = createHttpTrace(async () => new Response(raw), { write: x => logs.push(JSON.parse(x)) })
 expect((await (await t.fetch('https://school.mos.ru/')).text()).length).toBe(70000)
 expect(logs[1].body.reason).toBe('response-over-64KiB')
})
