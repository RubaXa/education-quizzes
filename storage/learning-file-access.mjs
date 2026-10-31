/** On-demand access through the existing event worker; originals stay private.
 * @see ../docs/modules/assessments/olympiad-history.md */
export async function issueLearningFileAccess({db,disk,event,clock=()=>Date.now()}){
 const {familyId,childId}=event??{},path=event?.sourceRef?.documentPath??''
 const parts=path.split('/'),requestId=parts[5]
 if(parts.length!==6||parts[0]!=='families'||parts[1]!==familyId||parts[2]!=='children'||parts[3]!==childId||parts[4]!=='mediaRequests'||event.sourceRef.kind!=='material'||event.sourceRef.recordId!==requestId||event.operationId!==`media-read:${requestId}`)return {state:'blocked',safeErrorCode:'media_source_invalid'}
 const ref=db.doc(path),snapshot=await ref.get(),request=snapshot.data()
 if(!snapshot.exists)return {state:'blocked',safeErrorCode:'media_request_missing'}
 const deny=async()=>{await ref.update({status:'failed',safeError:'media_access_denied',href:null,expiresAt:new Date(0)});return {state:'blocked',safeErrorCode:'media_access_denied'}}
 if(request.deviceUid!==event.actor?.uid||!/^[a-f0-9]{64}$/.test(request.fileId??''))return deny()
 const session=await db.doc(`deviceSessions/${request.deviceUid}`).get()
 const linkToken=session.data()?.linkToken
 if(typeof linkToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(linkToken))return deny()
 const link=await db.doc(`accessLinks/${linkToken}`).get(),personId=link.data()?.personId
 if(link.data()?.active!==true||typeof personId!=='string'||personId!==request.personId)return deny()
 const base=`families/${familyId}/children/${childId}`
 const [member,child,file]=await Promise.all([db.doc(`families/${familyId}/members/${personId}`).get(),db.doc(base).get(),db.doc(`${base}/learningFiles/${request.fileId}`).get()])
 const m=member.data(),f=file.data()
 if(m?.active!==true||!['parent','student'].includes(m.role)||!m.childIds?.includes(childId)||!child.exists||child.data()?.active===false||!file.exists||f.familyId!==familyId||f.childId!==childId||f.sha256!==request.fileId||m.role!=='parent'&&f.studentVisible!==true)return deny()
 const prefix=`app:/PETR/Семьи/${familyId}/${childId}/АрхивОлимпиад/${request.fileId}.`
 if(typeof f.path!=='string'||!f.path.startsWith(prefix)||!/^(pdf|png|jpg|webp)$/.test(f.path.slice(prefix.length)))return deny()
 const created=request.createdAt?.toMillis?.()??Date.parse(request.createdAt)
 if(!Number.isFinite(created)||clock()-created>5*60_000||created>clock()+60_000)return deny()
 // Revalidate even when replaying a successful request; a changed membership wins.
 if(request.status==='ready'&&(request.expiresAt?.toMillis?.()??Number(request.expiresAt))>clock())return {state:'complete'}
 const href=await disk.downloadHrefAt(f.path)
 await ref.update({status:'ready',href,expiresAt:new Date(clock()+5*60_000)})
 return {state:'complete'}
}
