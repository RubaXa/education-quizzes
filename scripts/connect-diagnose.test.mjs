/** @see ../docs/shared/server-runtime.md#авторизация-и-совместимость */
import{expect,it,vi}from'vitest'
import{main}from'./connect-diagnose.mjs'
it('checks the local environment without starting authentication or exposing proxy credentials',()=>{
 const run=vi.fn(),out=[];expect(main(['--check'],{run,write:m=>out.push(m),env:{HTTPS_PROXY:'https://private:secret@example.test'},cwd:'/fixture'})).toBe(0)
 expect(run).not.toHaveBeenCalled();expect(out.join('')).not.toMatch(/secret|example.test/);expect(out.join('')).toContain('Вход, регистрация устройства и передача доступа не запускались')
})
it('runs the local connector with inherited TTY and diagnostic mode, without a shell or npm download',()=>{
 const run=vi.fn(()=>({status:7})),out=[]
 expect(main(['--invite','a'.repeat(43)],{run,write:m=>out.push(m),env:{},cwd:'/fixture'})).toBe(7)
 expect(run.mock.calls[0][0]).toBe(process.execPath)
 expect(run.mock.calls[0][1]).toEqual([expect.stringContaining('packages/education-connect/bin/education-connect.mjs'),'--diagnose','--invite','a'.repeat(43)])
 expect(run.mock.calls[0][2]).toMatchObject({stdio:'inherit',shell:false})
 expect(out.join('')).not.toContain('a'.repeat(43))
})
it('rejects malformed arguments before running the connector',()=>{
 const run=vi.fn();expect(main(['--invite','bad;command'],{run,write:()=>{},env:{}})).toBe(2);expect(run).not.toHaveBeenCalled()
})
