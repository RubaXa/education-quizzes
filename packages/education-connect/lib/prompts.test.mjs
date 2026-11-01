/** @see ../../../docs/decisions/local-connect-diagnostics-2026-11-01.md */
import {expect,it} from 'vitest'
import {credentialInputSummary,removeLastUtf8Character} from './prompts.mjs'
it('backspace removes a whole UTF-8 character without damaging the previous one',()=>{
 for(const value of ['abc','абв','a😀','aя']) {
  const bytes=Array.from(Buffer.from(value));removeLastUtf8Character(bytes)
  expect(Buffer.from(bytes).toString('utf8')).toBe(Array.from(value).slice(0,-1).join(''))
 }
})
it('default input diagnostics reveal only length and edge whitespace, preserving the input',()=>{
 const password=' abЯ秘密 ';const out=credentialInputSummary(password)
 expect(out).toContain('7 символов');expect(out).toContain('пробелы по краям: есть');expect(out).not.toContain('abЯ');expect(password).toBe(' abЯ秘密 ')
})
it('explicit prefix inspection escapes terminal controls and never reveals an entire short password',()=>{
 expect(credentialInputSummary('AbЯ😀secret',{showPrefix:true})).toContain('начало: "AbЯ😀"')
 expect(credentialInputSummary('abc',{showPrefix:true})).toContain('начало: "ab"')
 expect(credentialInputSummary('a\u001b[31msecret',{showPrefix:true})).not.toContain('\u001b')
})
