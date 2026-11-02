/** @see ../docs/decisions/mesh-web-login-2026-11-02.md */
import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('takes phone then hidden password then requested SMS in a real TTY and persists only verified ownership',()=>{
 const dir=mkdtempSync(join(tmpdir(),'education-web-login-pty-'))
 try{
  const fixture=join(dir,'fixture.mjs')
  writeFileSync(join(dir,'secret.json'),JSON.stringify({actorPersonId:'fixture-parent',token:'previous'}))
  writeFileSync(fixture,`let state;const token='eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({msh:'fixture-parent'})).toString('base64url')+'.fixture';
  globalThis.fetch=async(url,opts)=>{const u=new URL(url),p=u.pathname;
  if(p==='/sps/oauth/register')throw Error('MOBILE REGISTRATION MUST NOT RUN');
  if(p==='/sps/oauth/ae'){state=u.searchParams.get('state');return Response.json({inquire:'choose_one',items:[{inquire:'login_with_password'}]},{headers:{'set-cookie':'sso=fixture; Secure; Path=/'}})}
  if(p.endsWith('/headless/password')){const b=new URLSearchParams(opts.body);if(b.get('login')!=='fixture-phone'||b.get('password')!=='fixture-password')throw Error('wrong input');return Response.json({inquire:'choose_one',items:[{inquire:'ask_to_send_sms'}]})}
  if(p.endsWith('/sms/bind'))return !opts.body?Response.json({inquire:'enter_sms_code'}):new Response('',{status:302,headers:{location:'https://school.mos.ru/v3/auth/sudir/callback?code=fixture&state='+state}});
  if(p==='/v3/auth/sudir/callback')return new Response('',{status:302,headers:{'set-cookie':'auth_token='+token+'; Secure; Path=/',location:'/diary'}});
  if(p.endsWith('/student_profiles'))return Response.json([{id:'child-profile',person_id:'child-person',user_name:'fixture-child'}]);
  if(p.endsWith('/profile_info'))return Response.json([{type:'ParentProfile'}]);
  if(p.endsWith('/profile'))return Response.json({profile:{type:'parent',id:'parent-profile'},children:[{id:'child-profile'}]});
  throw Error('unexpected endpoint');}`)
  const program=String.raw`
import os,pty,select,subprocess,sys,time,json
master,slave=pty.openpty()
p=subprocess.Popen([sys.argv[1],'--import',sys.argv[2],'diary/cli.mjs','login','--trace','--data-dir',sys.argv[3]],stdin=slave,stdout=slave,stderr=slave)
os.close(slave)
steps=[('Логин mos.ru'.encode(),'fixture-phone\n'.encode()),('Пароль mos.ru'.encode(),'fixture-password\n'.encode()),('Код из SMS'.encode(),'123456\n'.encode())]
out=b'';index=0;deadline=time.monotonic()+15
try:
 while time.monotonic()<deadline:
  readable,_,_=select.select([master],[],[],0.1)
  if readable:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   out+=chunk
   if index<len(steps) and steps[index][0] in out:
    os.write(master,steps[index][1]);index+=1
  if p.poll() is not None and not readable:break
 if p.poll() is None:p.kill()
 p.wait(timeout=3)
 print(json.dumps({'exit':p.returncode,'steps':index,'output':out.decode('utf8',errors='replace')},ensure_ascii=False))
finally:os.close(master)
`
  const child=spawnSync('python3',['-c',program,process.execPath,fixture,dir],{encoding:'utf8',timeout:20000})
  expect(child.status,child.stderr).toBe(0)
  const result=JSON.parse(child.stdout)
  expect(result.exit,result.output).toBe(0);expect(result.steps).toBe(3)
  expect(result.output.indexOf('Логин mos.ru')).toBeLessThan(result.output.indexOf('подготовка веб-входа'))
  expect(result.output).not.toContain('fixture-password')
  expect(result.output).not.toMatch(/Код из SMS[^\r\n]*123456/)
  expect(result.output).toContain('Родительский доступ подтверждён')
  const saved=JSON.parse(readFileSync(join(dir,'secret.json'),'utf8'))
  expect(saved).toMatchObject({authMethod:'web',actorPersonId:'fixture-parent',accountRole:'parent',profileId:'child-profile'})
  expect(saved.webSession.cookies.some(c=>c.key==='auth_token')).toBe(true)
 }finally{rmSync(dir,{recursive:true,force:true})}
},25000)

it('resumes the real CLI from a private checkpoint without credentials and deletes it only after verification',()=>{
 const dir=mkdtempSync(join(tmpdir(),'education-resume-cli-'))
 try{
  const fixture=join(dir,'fixture.mjs'),state='fixture-state-for-resume-cli'
  writeFileSync(join(dir,'secret.json'),JSON.stringify({actorPersonId:'fixture-parent',token:'previous'}))
  writeFileSync(join(dir,'login-pending.json'),JSON.stringify({schemaVersion:1,createdAt:Date.now(),state,url:'https://login.mos.ru/sps/login/ur/askToTrust',html:'fixture',session:{version:'tough-cookie@6.0.2',storeType:'MemoryCookieStore',rejectPublicSuffixes:true,cookies:[]}}),{mode:0o600})
  writeFileSync(fixture,`const token='eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({msh:'fixture-parent'})).toString('base64url')+'.fixture';globalThis.fetch=async(url,opts)=>{const p=new URL(url).pathname;if(opts.method==='POST')throw Error('CREDENTIAL POST MUST NOT RUN');if(p.endsWith('/askToTrust'))return new Response('',{status:303,headers:{location:'https://school.mos.ru/v3/auth/sudir/callback?code=fixture&state=${state}'}});if(p.endsWith('/sudir/callback'))return new Response('',{status:302,headers:{location:'/diary','set-cookie':'auth_token='+token+'; Secure; Path=/'}});if(p.endsWith('/student_profiles'))return Response.json([{id:'child-profile',person_id:'child-person',user_name:'fixture-child'}]);if(p.endsWith('/profile_info'))return Response.json([{type:'ParentProfile'}]);if(p.endsWith('/profile'))return Response.json({profile:{type:'parent',id:'parent-profile'},children:[{id:'child-profile'}]});throw Error('unexpected endpoint')}`)
  const child=spawnSync(process.execPath,['--import',fixture,'diary/cli.mjs','login','--resume','--trace','--data-dir',dir],{encoding:'utf8',timeout:10000,input:''})
  expect(child.status,child.stdout+child.stderr).toBe(0)
  expect(child.stdout).not.toContain('Пароль mos.ru (ввод скрыт)')
  expect(child.stdout).not.toContain('Код из SMS')
  expect(JSON.parse(readFileSync(join(dir,'secret.json'),'utf8'))).toMatchObject({authMethod:'web',actorPersonId:'fixture-parent'})
  expect(existsSync(join(dir,'login-pending.json'))).toBe(false)
  writeFileSync(join(dir,'login-pending.json'),JSON.stringify({createdAt:Date.now()-600001}))
  const expired=spawnSync(process.execPath,['--import',fixture,'diary/cli.mjs','login','--resume','--data-dir',dir],{encoding:'utf8',timeout:10000,input:''})
  expect(expired.status).not.toBe(0);expect(existsSync(join(dir,'login-pending.json'))).toBe(false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
