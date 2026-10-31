import { describe,it,expect,vi } from 'vitest'
import { issueLearningFileAccess } from './learning-file-access.mjs'
const hash='a'.repeat(64),now=Date.now()
function fixture(role='student'){
 const path='families/f/children/c/mediaRequests/r',filePath=`app:/PETR/Семьи/f/c/АрхивОлимпиад/${hash}.pdf`
 const rows=new Map([[path,{deviceUid:'device',personId:'person',fileId:hash,createdAt:new Date(now).toISOString(),status:'requested'}],['deviceSessions/device',{linkToken:'a'.repeat(43)}],[`accessLinks/${'a'.repeat(43)}`,{active:true,personId:'person'}],['families/f/members/person',{active:true,role,childIds:['c']}],['families/f/children/c',{active:true}],[`families/f/children/c/learningFiles/${hash}`,{familyId:'f',childId:'c',sha256:hash,studentVisible:true,path:filePath}]])
 const db={doc:path=>({get:async()=>({exists:rows.has(path),data:()=>rows.get(path)}),update:async v=>rows.set(path,{...rows.get(path),...v})})}
 const disk={downloadHrefAt:vi.fn(async()=> 'https://downloader.disk.yandex.net/temporary')},event={familyId:'f',childId:'c',actor:{uid:'device'},operationId:'media-read:r',sourceRef:{kind:'material',documentPath:path,recordId:'r'}}
 return {db,disk,event,clock:()=>now,rows,path}
}
describe('private learning file access',()=>{
 it.each(['student','parent'])('issues a temporary link after all %s ownership checks',async role=>{const f=fixture(role);expect(await issueLearningFileAccess(f)).toEqual({state:'complete'});expect(f.rows.get(f.path).href).toContain('https://');expect(f.disk.downloadHrefAt).toHaveBeenCalledOnce()})
 it.each(['revoked','other-child','parent-only','forged-path','stale-request'])('rejects %s before touching Disk',async reason=>{const f=fixture();if(reason==='revoked')f.rows.get(`accessLinks/${'a'.repeat(43)}`).active=false;if(reason==='other-child')f.rows.get('families/f/members/person').childIds=['other'];if(reason==='parent-only')f.rows.get(`families/f/children/c/learningFiles/${hash}`).studentVisible=false;if(reason==='forged-path')f.rows.get(`families/f/children/c/learningFiles/${hash}`).path='app:/PETR/other.pdf';if(reason==='stale-request')f.rows.get(f.path).createdAt=new Date(now-3600000).toISOString();expect((await issueLearningFileAccess(f)).state).toBe('blocked');expect(f.disk.downloadHrefAt).not.toHaveBeenCalled()})
 it('rechecks membership for replay of an already issued grant',async()=>{const f=fixture();await issueLearningFileAccess(f);f.rows.get('families/f/members/person').active=false;expect((await issueLearningFileAccess(f)).state).toBe('blocked');expect(f.rows.get(f.path).href).toBeNull()})
})
